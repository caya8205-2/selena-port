using AscNet.Common.Database;
using AscNet.GameServer;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.attrib;
using AscNet.Table.V2.share.character;
using AscNet.Table.V2.share.character.grade;
using AscNet.Table.V2.share.character.quality;
using AscNet.Table.V2.share.character.skill;
using AscNet.Table.V2.share.equip;
using MongoDB.Driver;
using MessagePack;
using DbCharacter = AscNet.Common.Database.Character;

namespace AscNet.Test
{
    internal partial class Program
    {
        /// <summary>
        /// A tune states a whole build and the builder writes it: rank, promotion, level, the six
        /// memories with their two resonances, the hypertune state, and the weapon with its three
        /// resonances and its harmony. The test asks for a build the account does not hold and
        /// checks the rows afterwards, because the point of the operation is that it does not
        /// depend on what the account owns.
        /// </summary>
        private static void ValidateTuneBuilder()
        {
            List<CharacterTable> characters = TableReaderV2.Parse<CharacterTable>();
            List<CharacterQualityFragmentTable> fragments = TableReaderV2.Parse<CharacterQualityFragmentTable>();
            List<EquipTable> equips = TableReaderV2.Parse<EquipTable>();
            List<EquipResonanceTable> resonanceRows = TableReaderV2.Parse<EquipResonanceTable>();
            List<AttribPoolTable> attribPools = TableReaderV2.Parse<AttribPoolTable>();
            List<CharacterSkillPoolTable> skillPools = TableReaderV2.Parse<CharacterSkillPoolTable>();

            CharacterTable character = characters.FirstOrDefault(row => row.Id == 1011002)
                ?? throw new InvalidDataException("tune builder: character 1011002 missing from Character.tsv.");
            int baseQuality = TableReaderV2.Parse<CharacterQualityTable>()
                .Where(row => row.CharacterId == character.Id)
                .Select(row => row.Quality)
                .DefaultIfEmpty(1)
                .Min();
            int maxGrade = TableReaderV2.Parse<CharacterGradeTable>()
                .Where(row => row.CharacterId == character.Id)
                .Select(row => row.Grade)
                .DefaultIfEmpty(1)
                .Max();

            // one memory per grid slot, each with a stat pool and a skill pool so both resonances
            // can be named from the tables instead of invented
            Dictionary<int, EquipTable> memories = [];
            for (int site = 1; site <= 6; site += 1)
            {
                EquipTable memory = equips.FirstOrDefault(row => row.Site == site
                    && resonanceRows.Any(resonance => resonance.Id == row.Id
                        && resonance.AttribPoolId.Count > 0 && resonance.AttribPoolId[0] > 0
                        && resonance.CharacterSkillPoolId.Count > 0 && resonance.CharacterSkillPoolId[0] > 0))
                    ?? throw new InvalidDataException($"tune builder: no memory with both pools on site {site}.");
                memories[site] = memory;
            }

            EquipTable weapon = equips.FirstOrDefault(row => row.Site == 0
                && resonanceRows.Any(resonance => resonance.Id == row.Id
                    && resonance.WeaponSkillPoolId.Count > 0 && resonance.WeaponSkillPoolId[0] > 0))
                ?? throw new InvalidDataException("tune builder: no weapon with a skill pool.");

            EquipResonanceTable weaponPools = resonanceRows.First(resonance => resonance.Id == weapon.Id);
            List<WeaponSkillPoolTable> weaponSkillPools = TableReaderV2.Parse<WeaponSkillPoolTable>();
            List<int> weaponSkills = weaponSkillPools
                .Where(row => row.PoolId == weaponPools.WeaponSkillPoolId[0])
                .SelectMany(row => row.SkillId)
                .Where(skillId => skillId > 0)
                .Distinct()
                .Take(3)
                .ToList();
            if (weaponSkills.Count < 3)
                throw new InvalidDataException("tune builder: the chosen weapon has fewer than three skills.");

            long uid = 90_6510;
            Player player = CreateDrawCompatibilityPlayer(uid);
            DbCharacter document = new()
            {
                Uid = uid,
                Characters = [],
                Equips = [],
                Fashions = [],
            };
            Inventory inventory = new() { Uid = uid };

            TuneRequest request = new()
            {
                Uid = uid,
                CharacterId = character.Id,
                Character = new TuneCharacter { Level = 80, Quality = 5, Star = 3, Grade = maxGrade },
                MemoryLevel = 45,
                Hypertune = true,
                SkillLevel = 18,
                Weapon = new TuneWeapon { TemplateId = weapon.Id, Level = 45, HarmonySuit = (int)memories[1].SuitId },
            };

            foreach ((int site, EquipTable memory) in memories)
            {
                EquipResonanceTable pools = resonanceRows.First(resonance => resonance.Id == memory.Id);
                int attribId = attribPools.First(row => row.PoolId == pools.AttribPoolId[0]).Id;
                // slot 2 of a memory carries the signature, QTE, core and class skills, which is the
                // first pool; the orb and basic attack skills of slot 1 live in the second one
                int skillPoolId = pools.CharacterSkillPoolId.Count > 0 ? pools.CharacterSkillPoolId[0] : 0;
                int skillId = skillPools.First(row => row.PoolId == skillPoolId && row.SkillId > 0).SkillId;
                request.Memories.Add(new TuneMemorySlot
                {
                    Slot = site,
                    TemplateId = memory.Id,
                    Top = new TuneResonance { Slot = 1, Type = "attrib", TemplateId = attribId },
                    Bottom = new TuneResonance { Slot = 2, Type = "skill", TemplateId = skillId },
                });
            }

            for (int index = 0; index < 3; index += 1)
                request.Weapon.Resonance.Add(new TuneResonance { Slot = index + 1, Type = "weapon", TemplateId = weaponSkills[index] });

            try
            {
                DbCharacter.collection.InsertOne(document);
                Inventory.collection.InsertOne(inventory);
                Player.collection.InsertOne(player);

                using LoopbackSessionHarness harness = new(document, player, inventory: inventory, sessionId: $"tune-builder-{uid}");
                TuneReport report = TuneBuilder.Apply(harness.Session, request);

                // a live client only learns about the build from the pushes: it keeps what it was
                // handed at login, so a write with no push reads as "nothing happened" in game
                List<(string Name, byte[] Content)> pushes = [];
                DateTime deadline = DateTime.UtcNow.AddMilliseconds(3000);
                while (DateTime.UtcNow < deadline)
                {
                    if (!harness.TryReadAvailablePacket("tune push", out Packet pushedPacket))
                    {
                        if (pushes.Count >= 2) break;
                        Thread.Sleep(20);
                        continue;
                    }
                    if (pushedPacket.Type != Packet.ContentType.Push) continue;
                    Packet.Push push = MessagePackSerializer.Deserialize<Packet.Push>(pushedPacket.Content);
                    pushes.Add((push.Name, push.Content));
                }
                AssertEqual(true, pushes.Any(push => push.Name == nameof(NotifyEquipDataList)),
                    "tune pushes the gear to a live client");
                AssertEqual(true, pushes.Any(push => push.Name == nameof(NotifyCharacterDataList)),
                    "tune pushes the construct to a live client");
                NotifyEquipDataList pushedGear = MessagePackSerializer.Deserialize<NotifyEquipDataList>(
                    pushes.First(push => push.Name == nameof(NotifyEquipDataList)).Content);
                AssertEqual(7, pushedGear.EquipDataList.Count, "tune push carries six memories and the weapon");
                NotifyCharacterDataList pushedConstruct = MessagePackSerializer.Deserialize<NotifyCharacterDataList>(
                    pushes.First(push => push.Name == nameof(NotifyCharacterDataList)).Content);
                AssertEqual(1, pushedConstruct.CharacterDataList.Count, "tune push carries the one construct");
                AssertEqual((uint)character.Id, (uint)pushedConstruct.CharacterDataList[0].Id, "tune push names the construct");

                // the construct reaches the rank that was asked for, and the report speaks in ranks
                CharacterData stored = document.Characters.Single();
                AssertEqual(5, stored.Quality, "tune rank quality");
                AssertEqual(3, stored.Star, "tune rank star");
                AssertEqual("SSS3", report.Rank, "tune rank label");
                AssertEqual(maxGrade, stored.Grade, "tune promotion");
                AssertEqual(80, stored.Level, "tune level");

                // every skill of the construct reaches the requested level, clamped to its own ceiling
                AssertEqual(true, report.Skills.Count > 0, "tune writes skill levels");
                // the ceiling is the bought level from CharacterSkillUpgrade (18), never the effect table,
                // whose rows go to 35 because they already include what six lower resonances add
                Dictionary<int, int> upgradeCaps = TableReaderV2.Parse<CharacterSkillUpgradeTable>()
                    .GroupBy(row => row.SkillId)
                    .ToDictionary(group => group.Key, group => group.Max(row => row.Level));
                foreach (TuneSkillResult skill in report.Skills)
                {
                    int skillCap = upgradeCaps.GetValueOrDefault(skill.Id);
                    AssertEqual(skillCap, skill.Level, $"tune skill level {skill.Id}");
                    AssertEqual(skill.Level, stored.SkillList.Single(entry => entry.Id == skill.Id).Level,
                        $"tune stored skill level {skill.Id}");
                }
                AssertEqual(true, report.Skills.Any(skill => skill.Level > 1), "tune raises a skill above its first level");
                AssertEqual(true, report.Skills.Any(skill => skill.Level == 18), "tune reaches the bought ceiling");
                AssertEqual(true, report.Skills.All(skill => skill.Level <= 18), "tune never writes a level above the bought ceiling");
                AssertEqual(report.Skills.Count, stored.SkillList.Count, "tune levels every skill the login reconciliation keeps");

                // six memories, bound to the construct, each with two resonances and hypertuned
                List<EquipData> storedMemories = document.Equips
                    .Where(equip => equips.First(row => row.Id == equip.TemplateId).Site > 0)
                    .ToList();
                AssertEqual(6, storedMemories.Count, "tune memory count");
                AssertEqual(6, storedMemories.Count(equip => equip.CharacterId == character.Id), "tune memory binding");
                AssertEqual(6, storedMemories.Count(equip => equip.ResonanceInfo.Count == 2), "tune memory resonance");
                // a stat resonance belongs to no construct, only a skill resonance does
                AssertEqual(0, storedMemories[0].ResonanceInfo.Single(info => info.Slot == 1).CharacterId, "tune attrib resonance carries no character");
                AssertEqual(character.Id, storedMemories[0].ResonanceInfo.Single(info => info.Slot == 2).CharacterId, "tune skill resonance carries the construct");
                AssertEqual(6, storedMemories.Count(equip => equip.AwakeSlotList.Count == 2), "tune hypertune");

                // the weapon carries three resonances and the harmony suit of the named memory
                EquipData storedWeapon = document.Equips.Single(equip => equip.TemplateId == weapon.Id);
                AssertEqual(3, storedWeapon.ResonanceInfo.Count, "tune weapon resonance");
                AssertEqual((int)memories[1].SuitId, storedWeapon.WeaponOverrunData.ChoseSuit, "tune harmony suit");
                AssertEqual(true, storedWeapon.WeaponOverrunData.Level > 0, "tune harmony level");

                // the last tier has no star step, so a star carried over into it is dropped
                TuneRequest top = new()
                {
                    Uid = uid,
                    CharacterId = character.Id,
                    Character = new TuneCharacter { Level = 80, Quality = 6, Star = 3, Grade = maxGrade },
                };
                TuneReport topped = TuneBuilder.Apply(harness.Session, top);
                AssertEqual(0, document.Characters.Single().Star, "tune drops the star above the last tier");
                AssertEqual("SSS+", topped.Rank, "tune last tier label");

                // a rank below the gacha rank is clamped, not written: an A construct stays at A
                TuneRequest floor = new()
                {
                    Uid = uid,
                    CharacterId = character.Id,
                    Character = new TuneCharacter { Level = 1, Quality = 1, Star = 0, Grade = 1 },
                };
                TuneReport floored = TuneBuilder.Apply(harness.Session, floor);
                AssertEqual((int)baseQuality, document.Characters.Single().Quality, "tune clamps below the base rank");
                AssertEqual(TuneBuilder.RankName(baseQuality, 0), floored.Rank, "tune floor label");

                // a resonance outside the pool is refused by the tables, not written
                bool refused = false;
                try
                {
                    TuneRequest bad = new()
                    {
                        Uid = uid,
                        CharacterId = character.Id,
                        Memories =
                        [
                            new TuneMemorySlot
                            {
                                Slot = 1,
                                TemplateId = memories[1].Id,
                                Top = new TuneResonance { Slot = 1, Type = "attrib", TemplateId = 999_999 },
                            },
                        ],
                    };
                    TuneBuilder.Apply(harness.Session, bad);
                }
                catch (InvalidOperationException)
                {
                    refused = true;
                }
                AssertEqual(true, refused, "tune refuses a resonance outside the pool");

                Console.WriteLine(
                    $"tune builder: {character.Name} to {report.Rank} {report.Promotion} level {report.Level}, "
                    + $"{report.Memories.Count} memories hypertuned, weapon {weapon.Name} with {report.Weapon!.Resonance.Count} resonances and harmony suit {report.Weapon.HarmonySuit}");
            }
            finally
            {
                DbCharacter.collection.DeleteMany(candidate => candidate.Uid == uid);
                Inventory.collection.DeleteMany(candidate => candidate.Uid == uid);
                Player.collection.DeleteMany(candidate => candidate.PlayerData.Id == player.PlayerData.Id);
            }
        }
    }
}