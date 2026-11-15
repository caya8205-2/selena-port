using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.character;
using AscNet.Table.V2.share.character.quality;
using AscNet.Table.V2.share.equip;
using AscNet.Table.V2.share.item;

namespace AscNet.GameServer
{
    /// <summary>
    /// Rank progression for one construct, read from the shipped tables instead of invented
    /// numbers: inside a quality the shard ladder is <c>CharacterQualityFragment.StarUseCount[Star]</c>
    /// of the construct's own shard item, and a quality step costs <c>PromoteUseCoin</c> of
    /// <c>PromoteItemId</c> while resetting the star to zero.
    /// <para>
    /// The game's own handlers spend the same values, but they answer the client's codes and clamp
    /// a short balance to zero; every step here refuses first and reports the shortfall, so a
    /// command cannot silently eat the shards and still grant the rank.
    /// </para>
    /// </summary>
    public static class CharacterProgression
    {
        private const int MaxStepsPerCall = 200;

        public sealed class Step
        {
            public string Kind { get; set; } = "none";
            public int ItemId { get; set; }
            public string ItemName { get; set; } = string.Empty;
            public int Cost { get; set; }
            public long Have { get; set; }
            public bool Affordable { get; set; }
            public string? Reason { get; set; }
        }

        public static Step NextStep(Session session, CharacterData character)
        {
            CharacterTable? row = Row(character);
            Step step = new();
            if (row is null)
            {
                step.Reason = "this character has no Character.tsv row";
                return step;
            }

            CharacterQualityFragmentTable? fragment = Fragment(row, character.Quality);
            if (fragment is null)
            {
                step.Reason = $"quality {character.Quality} has no fragment row";
                return step;
            }

            if (character.Star < fragment.StarUseCount.Count && fragment.StarUseCount[character.Star] > 0)
            {
                step.Kind = "star";
                step.ItemId = row.ItemId;
                step.ItemName = ItemName(row.ItemId);
                step.Cost = fragment.StarUseCount[character.Star];
                step.Have = Balance(session, row.ItemId);
                step.Affordable = step.Have >= step.Cost;
                return step;
            }

            if (!HasQuality(row, character.Quality + 1))
            {
                step.Reason = $"quality {character.Quality} is the last rank";
                return step;
            }

            int promoteItem = fragment.PromoteItemId ?? Inventory.Coin;
            step.Kind = "quality";
            step.ItemId = promoteItem;
            step.ItemName = ItemName(promoteItem);
            step.Cost = fragment.PromoteUseCoin ?? 0;
            step.Have = Balance(session, promoteItem);
            step.Affordable = step.Cost <= 0 || step.Have >= step.Cost;
            return step;
        }

        /// <summary>
        /// Advance one construct. <paramref name="mode"/> is <c>next</c> (one step), <c>star</c>
        /// (one shard step), <c>quality</c> (one quality step, refused while the shard ladder is
        /// unspent because the reset would waste it) or <c>max</c> (walk while the materials last).
        /// </summary>
        public static object Advance(Session session, int characterId, string mode)
        {
            CharacterData? character = session.character.Characters.FirstOrDefault(candidate => candidate.Id == characterId);
            if (character is null)
                throw new InvalidOperationException($"this account does not own character {characterId}.");

            CharacterTable? row = Row(character) ?? throw new InvalidOperationException("this character has no Character.tsv row.");
            int fromQuality = character.Quality;
            int fromStar = character.Star;
            List<object> applied = new();
            string? stopped = null;

            int limit = mode.Equals("max", StringComparison.OrdinalIgnoreCase) ? MaxStepsPerCall : 1;
            for (int index = 0; index < limit; index++)
            {
                Step step = NextStep(session, character);

                bool wantsStar = mode.Equals("star", StringComparison.OrdinalIgnoreCase);
                bool wantsQuality = mode.Equals("quality", StringComparison.OrdinalIgnoreCase);
                if (wantsStar && step.Kind != "star")
                {
                    stopped = step.Reason ?? "no shard step is left at this quality";
                    break;
                }
                if (wantsQuality && step.Kind != "quality")
                {
                    stopped = step.Kind == "star"
                        ? $"the shard ladder at quality {character.Quality} is not spent yet; a quality step would reset star {character.Star} and waste it"
                        : step.Reason ?? "no quality step is left";
                    break;
                }
                if (step.Kind == "none")
                {
                    stopped = step.Reason ?? "no step is left";
                    break;
                }
                if (!step.Affordable)
                {
                    stopped = $"{step.ItemName} {step.Have}/{step.Cost} - short by {step.Cost - step.Have}";
                    break;
                }

                Apply(session, character, row, step);
                applied.Add(new { kind = step.Kind, quality = character.Quality, star = character.Star, spent = step.Cost, itemId = step.ItemId });
            }

            if (applied.Count > 0)
            {
                session.character.SaveChecked();
                session.inventory.SaveChecked();
                session.SendPush(new NotifyCharacterDataList { CharacterDataList = { character } });
            }

            return new
            {
                ok = applied.Count > 0,
                requested = mode,
                steps = applied.Count,
                stopped,
                applied,
                character = Summarize(session, character, row),
            };
        }

        /// <summary>Grant the construct's shard material: a grant, never a rank change.</summary>
        public static object GrantShards(Session session, int characterId, int count)
        {
            if (count <= 0)
                throw new InvalidOperationException("the shard count must be positive.");
            CharacterData? character = session.character.Characters.FirstOrDefault(candidate => candidate.Id == characterId)
                ?? throw new InvalidOperationException($"this account does not own character {characterId}.");
            CharacterTable row = Row(character) ?? throw new InvalidOperationException("this character has no Character.tsv row.");

            NotifyItemDataList notify = new();
            notify.ItemDataList.Add(session.inventory.Do(row.ItemId, count));
            session.inventory.SaveChecked();
            session.SendPush(notify);

            return new
            {
                ok = true,
                itemId = row.ItemId,
                itemName = ItemName(row.ItemId),
                granted = count,
                have = Balance(session, row.ItemId),
                character = Summarize(session, character, row),
            };
        }

        /// <summary>The read model behind the builder: progression, costs and the equipped build.</summary>
        public static object Describe(Session session, int characterId)
        {
            CharacterData? character = session.character.Characters.FirstOrDefault(candidate => candidate.Id == characterId)
                ?? throw new InvalidOperationException($"this account does not own character {characterId}.");
            CharacterTable row = Row(character) ?? throw new InvalidOperationException("this character has no Character.tsv row.");

            Step step = NextStep(session, character);
            Dictionary<int, EquipTable> equips = TableReaderV2.Parse<EquipTable>().ToDictionary(equip => equip.Id);

            // The account's memory pile, worn ones first: the game binds a memory to a construct
            // by equipping it, and an admin grant leaves it unbound, so both are listed and the
            // panel marks which is worn.
            List<object> memories = session.character.Equips
                .Where(equip => equips.TryGetValue((int)equip.TemplateId, out EquipTable? table) && table.Site > 0)
                .OrderBy(equip => equip.CharacterId == characterId ? 0 : 1)
                .ThenBy(equip => equips[(int)equip.TemplateId].Site)
                .Select(equip => (object)new
                {
                    equipId = equip.Id,
                    templateId = equip.TemplateId,
                    name = equips[(int)equip.TemplateId].Name,
                    site = equips[(int)equip.TemplateId].Site,
                    star = equips[(int)equip.TemplateId].Star,
                    suitId = equips[(int)equip.TemplateId].SuitId,
                    level = equip.Level,
                    exp = equip.Exp,
                    breakthrough = equip.Breakthrough,
                    equippedTo = equip.CharacterId,
                    awakeSlots = equip.AwakeSlotList?.ToList() ?? new(),
                    resonance = equip.ResonanceInfo.Select(Resonance).ToList(),
                })
                .ToList();

            List<object> weapons = session.character.Equips
                .Where(equip => equips.TryGetValue((int)equip.TemplateId, out EquipTable? table) && table.Site == 0)
                .OrderBy(equip => equip.CharacterId == characterId ? 0 : 1)
                .Select(equip => (object)new
                {
                    equipId = equip.Id,
                    templateId = equip.TemplateId,
                    name = equips[(int)equip.TemplateId].Name,
                    star = equips[(int)equip.TemplateId].Star,
                    level = equip.Level,
                    breakthrough = equip.Breakthrough,
                    equippedTo = equip.CharacterId,
                    overrunLevel = equip.WeaponOverrunData?.Level ?? 0,
                    overrunActiveSuits = equip.WeaponOverrunData?.ActiveSuits?.ToList() ?? new(),
                    overrunChoseSuit = equip.WeaponOverrunData?.ChoseSuit ?? 0,
                    resonance = equip.ResonanceInfo.Select(Resonance).ToList(),
                })
                .ToList();

            return new
            {
                ok = true,
                character = Summarize(session, character, row),
                next = new { kind = step.Kind, itemId = step.ItemId, itemName = step.ItemName, cost = step.Cost, have = step.Have, affordable = step.Affordable, reason = step.Reason },
                memories,
                weapons,
            };
        }

        private static object Summarize(Session session, CharacterData character, CharacterTable row) => new
        {
            id = character.Id,
            name = row.Name,
            tradeName = row.TradeName,
            level = character.Level,
            exp = character.Exp,
            grade = character.Grade,
            quality = character.Quality,
            initQuality = character.InitQuality,
            star = character.Star,
            shardItemId = row.ItemId,
            shards = Balance(session, row.ItemId),
            skills = character.SkillList.Count,
            enhancedSkills = character.EnhanceSkillList.Count,
            magics = character.MagicList.Count,
        };

        private static object Resonance(ResonanceInfo resonance) => new
        {
            slot = resonance.Slot,
            type = resonance.Type.ToString(),
            templateId = resonance.TemplateId,
            characterId = resonance.CharacterId,
        };

        private static void Apply(Session session, CharacterData character, CharacterTable row, Step step)
        {
            if (step.Cost > 0)
            {
                NotifyItemDataList notify = new();
                notify.ItemDataList.Add(session.inventory.Do(step.ItemId, -step.Cost));
                session.SendPush(notify);
            }

            if (step.Kind == "star")
            {
                character.Star++;
                return;
            }

            character.Star = 0;
            character.Quality++;
            session.character.UnlockQualityGatedSkills(character, session.player.GatherRewards);
        }

        private static CharacterTable? Row(CharacterData character) =>
            TableReaderV2.Parse<CharacterTable>().FirstOrDefault(candidate => candidate.Id == (int)character.Id);

        private static CharacterQualityFragmentTable? Fragment(CharacterTable row, int quality) =>
            TableReaderV2.Parse<CharacterQualityFragmentTable>().FirstOrDefault(candidate => candidate.Type == row.Type && candidate.Quality == quality);

        private static bool HasQuality(CharacterTable row, int quality) =>
            TableReaderV2.Parse<CharacterQualityFragmentTable>().Any(candidate => candidate.Type == row.Type && candidate.Quality == quality);

        private static long Balance(Session session, int itemId) =>
            session.inventory.Items.FirstOrDefault(item => item.Id == itemId)?.Count ?? 0;

        private static string ItemName(int itemId) =>
            TableReaderV2.Parse<ItemTable>().FirstOrDefault(item => item.Id == itemId)?.Name ?? $"item {itemId}";
    }
}