using System.Globalization;
using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.character;
using AscNet.Table.V2.share.character.skill;
using AscNet.Table.V2.share.character.grade;
using AscNet.Table.V2.share.character.quality;
using AscNet.Table.V2.share.attrib;
using AscNet.Table.V2.share.equip;
using AscNet.Table.V2.share.item;
using DbCharacter = AscNet.Common.Database.Character;

namespace AscNet.GameServer
{
    /// <summary>
    /// Writes a construct's whole build in one pass: progression, the six memories with their
    /// resonance and hypertune state, and the weapon with its resonance and harmony.
    /// <para>
    /// Nothing here reads what the account owns. The control centre is a design surface: the
    /// caller states the build it wants, this class makes the tables agree with it and writes the
    /// rows. That is why no shard, cog or item is spent, and why a memory or a weapon the account
    /// never had can still be tuned in.
    /// </para>
    /// </summary>
    public static class TuneBuilder
    {
        public const int MemorySlots = 6;
        public const int WeaponResonanceSlots = 3;
        public const int MemoryResonanceSlots = 2;

        public static TuneReport Apply(Session session, TuneRequest request)
        {
            CharacterTable row = TableReaderV2.Parse<CharacterTable>()
                .FirstOrDefault(candidate => candidate.Id == request.CharacterId)
                ?? throw new InvalidOperationException($"character {request.CharacterId} has no Character.tsv row.");

            CharacterData character = session.character.Characters.FirstOrDefault(candidate => candidate.Id == request.CharacterId)
                ?? AddCharacter(session, row.Id);

            TuneReport report = new() { CharacterId = (int)character.Id };

            // progression: level, rank (quality plus its star step) and promotion
            int maxLevel = DbCharacter.characterLevelUpTemplates
                .Where(template => template.Type == row.LevelUpTemplateId)
                .Select(template => template.Level)
                .DefaultIfEmpty(0)
                .Max();
            character.Level = Math.Clamp(request.Character.Level, 1, Math.Max(1, maxLevel));
            character.Exp = 0;

            List<CharacterQualityFragmentTable> qualityRows = TableReaderV2.Parse<CharacterQualityFragmentTable>()
                .Where(candidate => candidate.Type == row.Type)
                .OrderBy(candidate => candidate.Quality)
                .ToList();
            // The gacha rank of this construct: the lowest quality row the table gives it.
            int baseQuality = TableReaderV2.Parse<CharacterQualityTable>()
                .Where(candidate => candidate.CharacterId == row.Id)
                .Select(candidate => candidate.Quality)
                .DefaultIfEmpty(character.InitQuality > 0 ? character.InitQuality : 1)
                .Min();
            int maxQuality = qualityRows.Select(candidate => candidate.Quality).DefaultIfEmpty(baseQuality).Max();
            int quality = Math.Clamp(request.Character.Quality > 0 ? request.Character.Quality : baseQuality, baseQuality, maxQuality);
            int starCount = StarCount(qualityRows.FirstOrDefault(candidate => candidate.Quality == quality));
            character.Quality = quality;
            character.Star = Math.Clamp(request.Character.Star, 0, Math.Max(0, starCount - 1));

            int maxGrade = TableReaderV2.Parse<CharacterGradeTable>()
                .Where(candidate => candidate.CharacterId == row.Id)
                .Select(candidate => candidate.Grade)
                .DefaultIfEmpty(1)
                .Max();
            character.Grade = Math.Clamp(request.Character.Grade > 0 ? request.Character.Grade : character.Grade, 1, maxGrade);

            report.Level = character.Level;
            report.Rank = RankName(character.Quality, character.Star);
            report.Promotion = PromotionName(row.Id, character.Grade);

            // the six memories: reuse a row that already belongs to this construct, otherwise make one
            Dictionary<int, EquipTable> equipRows = TableReaderV2.Parse<EquipTable>()
                .ToDictionary(equip => equip.Id);
            List<uint> keep = [];
            List<EquipData> writtenEquips = [];
            List<uint> removedEquipIds = [];
            foreach (TuneMemorySlot slot in request.Memories.Where(slot => slot.Slot >= 1 && slot.Slot <= MemorySlots).OrderBy(slot => slot.Slot))
            {
                if (!equipRows.TryGetValue(slot.TemplateId, out EquipTable? memoryRow) || memoryRow.Site <= 0)
                    throw new InvalidOperationException($"memory {slot.TemplateId} is not a memory in Equip.tsv.");

                EquipData equip = ResolveEquip(session, character, slot.TemplateId, slot.Slot, memoryRow.Site);
                ApplyEquipProgression(equip, memoryRow, request.MemoryLevel);
                equip.CharacterId = (int)character.Id;

                // A memory's resonance is what locks it to this construct, so both slots are written
                // here rather than left to a later equip step.
                equip.ResonanceInfo = [];
                foreach (TuneResonance resonance in new[] { slot.Top, slot.Bottom }.OfType<TuneResonance>())
                {
                    ResonanceInfo info = BuildResonance(memoryRow, resonance, (int)character.Id);
                    if (equip.ResonanceInfo.All(existing => existing.Slot != info.Slot))
                        equip.ResonanceInfo.Add(info);
                }

                // Hypertune is the awaken state of a memory's resonance slots; a slot that holds no
                // resonance has nothing to awaken, so it stays out.
                equip.AwakeSlotList = request.Hypertune
                    ? equip.ResonanceInfo.Select(info => (dynamic)info.Slot).ToList()
                    : [];

                keep.Add(equip.Id);
                writtenEquips.Add(equip);
                report.Memories.Add(new TuneMemoryResult
                {
                    Slot = slot.Slot,
                    TemplateId = (int)equip.TemplateId,
                    Name = memoryRow.Name,
                    Level = equip.Level,
                    Resonance = equip.ResonanceInfo.Select(info => info.TemplateId).ToList(),
                    Hypertuned = request.Hypertune,
                });
            }

            if (request.Memories.Count > 0)
            {
                // anything this construct used to carry that the build no longer names is removed,
                // because a stale seventh memory would keep showing in the grid. The client has to
                // hear about the removal too, or it keeps drawing the piece it was handed at login.
                List<EquipData> stale = session.character.Equips
                    .Where(equip => equip.CharacterId == character.Id
                        && equipRows.TryGetValue((int)equip.TemplateId, out EquipTable? candidate)
                        && candidate.Site > 0
                        && !keep.Contains(equip.Id))
                    .ToList();
                removedEquipIds.AddRange(stale.Select(equip => equip.Id));
                session.character.Equips.RemoveAll(equip => stale.Contains(equip));
            }

            if (request.Weapon is not null)
            {
                (TuneWeaponResult weaponReport, EquipData weaponEquip) = ApplyWeapon(session, character, request.Weapon, equipRows);
                report.Weapon = weaponReport;
                writtenEquips.Add(weaponEquip);
            }

            session.character.Save();

            // A client that is in game keeps the construct and the gear it was handed at login, so the
            // write on its own is invisible: every handler that changes a construct or a piece of gear
            // pushes the same two notifications. A socketless session has no writer, and Send drops
            // the frame there.
            NotifyEquipDataList equipPush = new();
            equipPush.EquipDataList.AddRange(writtenEquips);
            equipPush.DeletedEquipIdList.AddRange(removedEquipIds);
            if (equipPush.EquipDataList.Count > 0 || equipPush.DeletedEquipIdList.Count > 0)
                session.SendPush(equipPush);
            session.SendPush(new NotifyCharacterDataList { CharacterDataList = { character } });

            return report;
        }

        private static (TuneWeaponResult Report, EquipData Equip) ApplyWeapon(
            Session session,
            CharacterData character,
            TuneWeapon request,
            Dictionary<int, EquipTable> equipRows)
        {
            if (!equipRows.TryGetValue(request.TemplateId, out EquipTable? weaponRow) || weaponRow.Site != 0)
                throw new InvalidOperationException($"weapon {request.TemplateId} is not a weapon in Equip.tsv.");

            // Rarity decides what the weapon can carry: only a six star takes a chosen resonance and a
            // harmony. A five star resonates flat attack, a four star is the default weapon.
            if (weaponRow.Star < 6 && (request.Resonance.Count > 0 || request.HarmonySuit > 0))
                throw new InvalidOperationException($"{weaponRow.Name} is a {weaponRow.Star} star weapon: only a 6 star takes custom resonance and harmony.");

            EquipData equip = ResolveEquip(session, character, request.TemplateId, 0, 0);
            ApplyEquipProgression(equip, weaponRow, request.Level);
            equip.CharacterId = (int)character.Id;

            equip.ResonanceInfo = [];
            foreach (TuneResonance resonance in request.Resonance.Take(WeaponResonanceSlots))
            {
                ResonanceInfo info = BuildResonance(weaponRow, resonance, (int)character.Id);
                if (equip.ResonanceInfo.All(existing => existing.Slot != info.Slot))
                    equip.ResonanceInfo.Add(info);
            }

            // Harmony: the weapon borrows a memory set, and an active harmony counts as two pieces of
            // it. The caller names the set, so the picker is a set list, not a memory list: four
            // signature memories plus harmony already complete a four piece bonus.
            if (request.HarmonySuit > 0)
            {
                bool suitExists = equipRows.Values.Any(row => row.Site > 0 && row.SuitId == request.HarmonySuit);
                if (!suitExists)
                    throw new InvalidOperationException($"suit {request.HarmonySuit} is not a memory set in Equip.tsv, so it cannot be a harmony.");

                List<WeaponOverrunTable> overrunRows = TableReaderV2.Parse<WeaponOverrunTable>()
                    .Where(candidate => candidate.WeaponId == weaponRow.Id)
                    .OrderBy(candidate => candidate.Level)
                    .ToList();
                equip.WeaponOverrunData ??= new WeaponOverrunData();
                equip.WeaponOverrunData.ChoseSuit = request.HarmonySuit;
                equip.WeaponOverrunData.ActiveSuits = [.. equip.WeaponOverrunData.ActiveSuits.Append(request.HarmonySuit).Distinct()];
                equip.WeaponOverrunData.Level = overrunRows.Select(candidate => candidate.Level).DefaultIfEmpty(0).Max();
            }

            return (new TuneWeaponResult
            {
                TemplateId = (int)equip.TemplateId,
                Name = weaponRow.Name,
                Level = equip.Level,
                Resonance = equip.ResonanceInfo.Select(info => info.TemplateId).ToList(),
                HarmonySuit = equip.WeaponOverrunData?.ChoseSuit ?? 0,
            }, equip);
        }

        private static EquipData ResolveEquip(Session session, CharacterData character, int templateId, int site, int tableSite)
        {
            // Reuse the row this construct already holds for that slot so an equip id stays stable
            // across tunes; a fresh id only appears when the build names a piece it never had.
            EquipData? existing = session.character.Equips.FirstOrDefault(equip =>
                equip.TemplateId == templateId && equip.CharacterId == character.Id);

            if (existing is null && site > 0)
            {
                existing = session.character.Equips.FirstOrDefault(equip =>
                    equip.CharacterId == character.Id
                    && equip.TemplateId != templateId
                    && IsSameSite(equip, tableSite));
            }

            if (existing is not null)
                return existing;

            EquipData created = new()
            {
                Id = NextEquipId(session),
                TemplateId = (uint)templateId,
                CharacterId = (int)character.Id,
                CreateTime = (uint)DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            };
            session.character.Equips.Add(created);
            return created;
        }

        private static bool IsSameSite(EquipData equip, int site)
        {
            EquipTable? row = TableReaderV2.Parse<EquipTable>().FirstOrDefault(candidate => candidate.Id == equip.TemplateId);
            return row is not null && row.Site == site;
        }

        private static uint NextEquipId(Session session)
        {
            uint highest = session.character.Equips.Count == 0 ? 0 : session.character.Equips.Max(equip => equip.Id);
            return highest + 1;
        }

        private static void ApplyEquipProgression(EquipData equip, EquipTable row, int requestedLevel)
        {
            List<EquipBreakThroughTable> steps = [];
            for (int index = 0; DbCharacter.ResolveEquipBreakThrough((uint)row.Id, index) is { } step; index += 1)
                steps.Add(step);

            if (steps.Count == 0)
            {
                equip.Level = Math.Max(1, requestedLevel);
                equip.Breakthrough = 0;
                equip.Exp = 0;
                return;
            }

            int levelLimit = steps[^1].LevelLimit;
            int level = Math.Clamp(requestedLevel <= 0 ? levelLimit : requestedLevel, 1, Math.Max(1, levelLimit));
            int breakthrough = 0;
            for (int index = 0; index < steps.Count; index += 1)
            {
                if (steps[index].LevelLimit <= level)
                    breakthrough = index;
            }

            equip.Level = level;
            equip.Breakthrough = breakthrough;
            equip.Exp = 0;
        }

        private static ResonanceInfo BuildResonance(EquipTable row, TuneResonance request, int characterId)
        {
            int slot = Math.Clamp(request.Slot, 1, row.Site > 0 ? MemoryResonanceSlots : WeaponResonanceSlots);
            EquipResonanceType type = request.Type.ToLowerInvariant() switch
            {
                "attrib" => EquipResonanceType.Attrib,
                "skill" or "characterskill" => EquipResonanceType.CharacterSkill,
                "weapon" or "weaponskill" => EquipResonanceType.WeaponSkill,
                _ => throw new InvalidOperationException($"resonance type '{request.Type}' is not one the game knows."),
            };

            List<int> allowed = AllowedResonanceIds(row, slot, type, characterId);
            if (allowed.Count > 0 && !allowed.Contains(request.TemplateId))
                throw new InvalidOperationException($"resonance {request.TemplateId} is not in slot {slot} of {row.Name}.");

            return new ResonanceInfo
            {
                Slot = slot,
                Type = type,
                CharacterId = type == EquipResonanceType.Attrib ? 0 : characterId,
                TemplateId = request.TemplateId,
            };
        }

        private static List<int> AllowedResonanceIds(EquipTable row, int slot, EquipResonanceType type, int characterId)
        {
            EquipResonanceTable? resonance = TableReaderV2.Parse<EquipResonanceTable>()
                .FirstOrDefault(candidate => candidate.Id == row.Id);
            if (resonance is null)
                return [];

            int poolId = type switch
            {
                EquipResonanceType.Attrib => At(resonance.AttribPoolId, slot - 1),
                EquipResonanceType.CharacterSkill => At(resonance.CharacterSkillPoolId, slot - 1),
                _ => At(resonance.WeaponSkillPoolId, slot - 1),
            };
            if (poolId <= 0)
                return [];

            if (type == EquipResonanceType.Attrib)
                return TableReaderV2.Parse<AttribPoolTable>()
                    .Where(candidate => candidate.PoolId == poolId)
                    .Select(candidate => candidate.Id)
                    .ToList();

            if (type == EquipResonanceType.CharacterSkill)
            {
                // A memory shows the same stat list on both slots but a different skill list: the
                // upper slot carries the orb and basic attack levels, the lower slot the signature,
                // QTE, core and class skills. The skill type is what separates them, 5/6/7/9 against
                // 1/2/3/4, and it is the same for every construct.
                if (row.Site <= 0)
                    return TableReaderV2.Parse<CharacterSkillPoolTable>()
                        .Where(candidate => candidate.PoolId == poolId)
                        .Select(candidate => candidate.SkillId)
                        .ToList();

                HashSet<int> wanted = slot == 1 ? [5, 6, 7, 9] : [1, 2, 3, 4];
                Dictionary<int, int> skillTypes = TableReaderV2.Parse<CharacterSkillTypeTable>()
                    .ToDictionary(candidate => candidate.Id, candidate => candidate.Type);
                List<int> poolIds = [.. CollectSkillPools(resonance)];
                return TableReaderV2.Parse<CharacterSkillPoolTable>()
                    .Where(candidate => poolIds.Contains(candidate.PoolId))
                    .Select(candidate => candidate.SkillId)
                    .Where(skillId => skillTypes.TryGetValue(skillId, out int skillType) && wanted.Contains(skillType))
                    .Distinct()
                    .ToList();
            }

            return TableReaderV2.Parse<WeaponSkillPoolTable>()
                .Where(candidate => candidate.PoolId == poolId)
                .SelectMany(candidate => candidate.SkillId)
                .Where(skillId => skillId > 0)
                .ToList();
        }

        private static IEnumerable<int> CollectSkillPools(EquipResonanceTable resonance)
        {
            foreach (int poolId in resonance.CharacterSkillPoolId)
            {
                if (poolId > 0)
                    yield return poolId;
            }
        }

        private static int At(List<int> values, int index) => index >= 0 && index < values.Count ? values[index] : 0;

        private static CharacterData AddCharacter(Session session, int templateId)
        {
            int baseQuality = TableReaderV2.Parse<CharacterQualityTable>()
                .Where(candidate => candidate.CharacterId == templateId)
                .Select(candidate => candidate.Quality)
                .DefaultIfEmpty(1)
                .Min();
            CharacterData character = new()
            {
                Id = (uint)templateId,
                Level = 1,
                Quality = baseQuality,
                InitQuality = baseQuality,
                Grade = 1,
                CreateTime = (int)DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                SkillList = [],
                EnhanceSkillList = [],
                MagicList = [],
            };
            session.character.Characters.Add(character);
            return character;
        }

        /// <summary>How many star steps a rank has; the last tier has none.</summary>
        private static int StarCount(CharacterQualityFragmentTable? row) => row?.StarUseCount?.Count ?? 0;

        /// <summary>The rank a player sees: S, S10, SS0, SSS+, with no star after the last tier.</summary>
        public static string RankName(int quality, int star)
        {
            string label = quality switch
            {
                1 => "B",
                2 => "A",
                3 => "S",
                4 => "SS",
                5 => "SSS",
                6 => "SSS+",
                _ => $"Q{quality}",
            };
            return quality >= 6 ? label : label + star.ToString(CultureInfo.InvariantCulture);
        }

        private static string PromotionName(int characterId, int grade)
        {
            CharacterGradeTable? row = TableReaderV2.Parse<CharacterGradeTable>()
                .FirstOrDefault(candidate => candidate.CharacterId == characterId && candidate.Grade == grade);
            return row?.GradeName ?? $"grade {grade}";
        }
    }

    public sealed class TuneRequest
    {
        public long Uid { get; set; }
        public int CharacterId { get; set; }
        public TuneCharacter Character { get; set; } = new();
        public int MemoryLevel { get; set; }
        public bool Hypertune { get; set; }
        public List<TuneMemorySlot> Memories { get; set; } = [];
        public TuneWeapon? Weapon { get; set; }
    }

    public sealed class TuneCharacter
    {
        public int Level { get; set; }
        public int Quality { get; set; }
        public int Star { get; set; }
        public int Grade { get; set; }
    }

    public sealed class TuneMemorySlot
    {
        public int Slot { get; set; }
        public int TemplateId { get; set; }
        public TuneResonance? Top { get; set; }
        public TuneResonance? Bottom { get; set; }
    }

    public sealed class TuneResonance
    {
        public int Slot { get; set; }
        public string Type { get; set; } = "attrib";
        public int TemplateId { get; set; }
    }

    public sealed class TuneWeapon
    {
        public int TemplateId { get; set; }
        public int Level { get; set; }
        public List<TuneResonance> Resonance { get; set; } = [];
        public int HarmonySuit { get; set; }
    }

    public sealed class TuneReport
    {
        public int CharacterId { get; set; }
        public int Level { get; set; }
        public string Rank { get; set; } = string.Empty;
        public string Promotion { get; set; } = string.Empty;
        public List<TuneMemoryResult> Memories { get; set; } = [];
        public TuneWeaponResult? Weapon { get; set; }
    }

    public sealed class TuneMemoryResult
    {
        public int Slot { get; set; }
        public int TemplateId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int Level { get; set; }
        public List<int> Resonance { get; set; } = [];
        public bool Hypertuned { get; set; }
    }

    public sealed class TuneWeaponResult
    {
        public int TemplateId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int Level { get; set; }
        public List<int> Resonance { get; set; } = [];
        public int HarmonySuit { get; set; }
    }
}