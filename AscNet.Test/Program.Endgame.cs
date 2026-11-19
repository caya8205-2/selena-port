using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.fuben.arena;
using AscNet.Table.V2.share.fuben.bosssingle;
using MessagePack;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace AscNet.Test;

internal partial class Program
{
    private static void ValidateEndgame()
    {
        using MongoCollectionOverride mongo = MongoCollectionOverride.InstallForBossCompatibility(out _, out _);
        const long playerId = 99_680;
        Player player = CreateDrawCompatibilityPlayer(playerId);
        player.SimulatedBattlefield = new();
        Character roster = CreateDrawCompatibilityCharacter(playerId);
        Inventory inventory = CreateDrawCompatibilityInventory(playerId, []);
        using LoopbackSessionHarness harness = new(roster, player, inventory, "endgame");
        harness.Session.stage = CreateLoginAccountCompatibilityStage(playerId);

        int playerLevel = checked((int)player.PlayerData.Level);
        List<BossSingleGradeTable> grades = TableReaderV2.Parse<BossSingleGradeTable>().ToList();
        int afresh = grades.Max(row => row.AfreshId);
        int expectedStandard = grades
            .Where(row => row.AfreshId == afresh && row.PreGradeType == 0
                && playerLevel >= row.MinPlayerLevel && playerLevel <= row.MaxPlayerLevel)
            .Select(row => row.LevelType).Max();
        int expectedUltimate = grades
            .Where(row => row.AfreshId == afresh && row.PreGradeType > 0)
            .Select(row => row.LevelType).Max();

        EndgameCatalog catalog = EndgameBuilder.Catalog(harness.Session);
        AssertEqual(true, catalog.Arena.Tiers.Count >= 7, "arena tiers come from ArenaLevel.tsv");
        AssertEqual(expectedStandard, catalog.Boss.Standard, "catalog standard grade matches the player's level band");
        AssertEqual(expectedUltimate, catalog.Boss.Ultimate, "catalog ultimate grade is the score-gated one");
        AssertEqual(true, catalog.Arena.AreaDetails.ContainsKey(12), "catalog explains the ice zone's stage");
        AssertEqual(true, catalog.Arena.AreaDetails[12].Desc.Length > 0, "the ice zone carries its archetype description");
        AssertEqual(true, catalog.Arena.AreaDetails[12].Buffs.Count >= 1, "the ice zone names its element buff");

        int legend = catalog.Arena.Tiers.Single(tier => tier.Name == "Legend").Id;
        int hero = catalog.Arena.Tiers.Single(tier => tier.Name == "Hero").Id;
        AssertEqual(true, legend != hero, "Legend and Hero are distinct tiers");

        EndgameApplyReport applied = EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaLevel = legend,
            BossLevelType = expectedUltimate,
        });
        AssertEqual(legend, applied.ArenaLevel, "arena tier jumped to Legend");
        AssertEqual(expectedUltimate, applied.BossLevelType, "ppc grade jumped to Ultimate");
        AssertEqual(legend, player.SimulatedBattlefield.ArenaLevel, "arena tier written to state");
        AssertEqual(expectedUltimate, player.SimulatedBattlefield.BossLevelType, "ppc grade written to state");
        AssertEqual(true, player.SimulatedBattlefield.BossList.Count > 0, "ultimate boss list built");

        EndgameCatalog after = EndgameBuilder.Catalog(harness.Session);
        AssertEqual(legend, after.Arena.Current, "catalog reports the current arena tier");
        AssertEqual(expectedUltimate, after.Boss.Current, "catalog reports the current ppc grade");
        AssertEqual(true, CurrentGroups(after).Count > 0, "weekly zone groups are offered");
        AssertEqual(true, after.Boss.UltimateGroups.Count > 0, "ultimate boss groups are offered");
        AssertEqual(true, after.Boss.SectionNames.Count > 0, "ppc sections carry the boss name the client shows");
        AssertEqual(true, after.Boss.StandardGroups.Concat(after.Boss.UltimateGroups)
            .All(group => group.Sections.All(sectionId => after.Boss.SectionNames.ContainsKey(sectionId))),
            "every offered section resolves a boss name");

        // Zones are tier-specific: Hero+ carries the Entropic Distortion affix zone, lower tiers do not.
        EndgameArenaTier legendTier = after.Arena.Tiers.Single(tier => tier.Id == legend);
        AssertEqual(true, legendTier.SpecialZone is not null, "a Hero+ tier carries the Entropic Distortion affix zone");
        AssertEqual(true, legendTier.SpecialZone!.Buffs.Count >= 2, "the affix zone names its two buff options");
        int vanguard = catalog.Arena.Tiers.Single(tier => tier.Name == "Vanguard").Id;
        AssertEqual(true, catalog.Arena.Tiers.Single(tier => tier.Id == vanguard).SpecialZone is null,
            "a lower tier carries no affix zone");

        // Each element group offers a Mob, Elite and Boss area since the 2026-11-19 capture curation;
        // take a differing area when the group offers one, otherwise the supported area itself.
        EndgameZoneGroup zone = CurrentGroups(after)[0];
        int zonePick = zone.Areas.Count >= 2 ? zone.Areas.First(areaId => areaId != zone.Chosen) : zone.Chosen;
        int unsupportedArea = zone.Key.Split('|').Select(int.Parse).First(areaId => !zone.Areas.Contains(areaId));
        EndgameBossGroup bossGroup = after.Boss.UltimateGroups.First(group => group.Sections.Count >= 2);
        int bossPick = bossGroup.Sections.First(sectionId => sectionId != bossGroup.Chosen);
        int bossIndex = after.Boss.UltimateGroups.FindIndex(group => group.Id == bossGroup.Id);

        EndgameApplyReport picked = EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaAreas = new Dictionary<string, int> { [zone.Key] = zonePick },
            BossSections = new Dictionary<int, int> { [bossGroup.Id] = bossPick },
        });
        AssertEqual(zonePick, picked.ArenaAreas[zone.Key], "zone override stored");
        AssertEqual(bossPick, picked.BossSections[bossGroup.Id], "boss override stored");
        AssertEqual(legend, picked.ArenaLevel, "picking zones keeps the tier");
        AssertEqual(expectedUltimate, picked.BossLevelType, "picking bosses keeps the grade");

        EndgameCatalog pickedCatalog = EndgameBuilder.Catalog(harness.Session);
        AssertEqual(zonePick, CurrentGroups(pickedCatalog).First(group => group.Key == zone.Key).Chosen,
            "the weekly zone honors the admin pick");
        AssertEqual(bossPick, player.SimulatedBattlefield.BossList[bossIndex],
            "the weekly boss list honors the admin pick");

        // A pick the group does not support must never empty the week: it falls back to the rotation.
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaAreas = new Dictionary<string, int> { [zone.Key] = unsupportedArea },
        });
        AssertEqual(zone.Chosen, CurrentGroups(EndgameBuilder.Catalog(harness.Session)).First(group => group.Key == zone.Key).Chosen,
            "an unsupported zone pick falls back to the rotation");
        AssertEqual(bossPick, player.SimulatedBattlefield.BossList[bossIndex],
            "a zone-only apply leaves the boss pick intact");

        EndgameApplyReport cleared = EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaAreas = new Dictionary<string, int>(),
            BossSections = new Dictionary<int, int>(),
        });
        AssertEqual(0, cleared.ArenaAreas.Count, "an empty zone dict clears the override");
        AssertEqual(0, cleared.BossSections.Count, "an empty boss dict clears the override");
        AssertEqual(legend, cleared.ArenaLevel, "clearing picks keeps the tier");
        AssertEqual(expectedUltimate, cleared.BossLevelType, "clearing picks keeps the grade");
        EndgameCatalog clearedCatalog = EndgameBuilder.Catalog(harness.Session);
        AssertEqual(true, CurrentGroups(clearedCatalog).First(group => group.Key == zone.Key).Chosen != zonePick
            || zone.Areas.Count == 1, "clearing the zone override returns to the rotation");

        EndgameApplyReport second = EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaLevel = hero,
            BossLevelType = expectedStandard,
        });
        AssertEqual(hero, second.ArenaLevel, "a second tier jump lands on Hero");
        AssertEqual(expectedStandard, second.BossLevelType, "a second grade jump lands on standard");
        AssertEqual(true, player.SimulatedBattlefield.BossList.Count > 0, "standard boss list built");

        Player reloaded = BsonSerializer.Deserialize<Player>(player.ToBson());
        AssertEqual(hero, reloaded.SimulatedBattlefield.ArenaLevel, "arena tier persists through Bson");
        AssertEqual(expectedStandard, reloaded.SimulatedBattlefield.BossLevelType, "ppc grade persists through Bson");

        // A grade jump starts a fresh cycle: the old grade's totals must not ride onto the new bosses.
        player.SimulatedBattlefield.BossStageRecords.Add(new BossSingleStageRecordState { StageId = 999001, Score = 123456, MaxScore = 123456 });
        player.SimulatedBattlefield.BossTotalScore = 123456;
        player.SimulatedBattlefield.BossCurrentTotalScore = 123456;
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, BossLevelType = expectedUltimate });
        AssertEqual(0, player.SimulatedBattlefield.BossTotalScore, "a grade jump clears the old grade's total");
        AssertEqual(0, player.SimulatedBattlefield.BossStageRecords.Count, "a grade jump clears the old grade's records");

        // The reset button refills attempts and stamina but never the score. Pin the daily period first so
        // the same-grade apply below is not rolled over by the live reconcile.
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, ResetBossAttempts = true });
        player.SimulatedBattlefield.BossStageRecords.Add(new BossSingleStageRecordState { StageId = 999002, Score = 777, MaxScore = 777 });
        player.SimulatedBattlefield.BossTotalScore = 777;
        player.SimulatedBattlefield.BossCurrentTotalScore = 777;
        player.SimulatedBattlefield.BossChallengeCount = 3;
        player.SimulatedBattlefield.BossCharacterPoints[102] = 2;
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, BossLevelType = expectedUltimate });
        AssertEqual(777, player.SimulatedBattlefield.BossTotalScore, "a same-grade apply keeps the cycle score");
        AssertEqual(3, player.SimulatedBattlefield.BossChallengeCount, "a same-grade apply keeps the used attempts");
        EndgameApplyReport reset = EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, ResetBossAttempts = true });
        AssertEqual(0, player.SimulatedBattlefield.BossChallengeCount, "the reset button refills the daily attempts");
        AssertEqual(0, player.SimulatedBattlefield.BossCharacterPoints.Count, "the reset button refills construct stamina");
        AssertEqual(777, player.SimulatedBattlefield.BossTotalScore, "the reset button keeps the cycle score");
        AssertEqual(expectedUltimate, reset.BossLevelType, "the reset button keeps the grade");

        // An admin apply must reach a live client at once, not only after the next reset or login.
        DrainPushes(harness);
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, BossLevelType = expectedStandard });
        AssertEqual(true, SawPush(harness, nameof(NotifyFubenBossSingleData)), "a grade apply pushes the Pain Cage login data");
        DrainPushes(harness);
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, ArenaLevel = legend });
        AssertEqual(true, SawPush(harness, nameof(NotifyArenaActivity)), "a tier apply pushes the War Zone board");

        // Group and affix pins replace the rotation without waiting for the weekly hash.
        EndgameCatalog board = EndgameBuilder.Catalog(harness.Session);
        EndgameArenaTier legendBoard = board.Arena.Tiers.Single(tier => tier.Id == legend);
        int defaultSpecial = legendBoard.SpecialZone!.AreaId;
        string physicalKey = legendBoard.GroupOptions.First(group => group.Areas.Contains(11)).Key;
        string lightningKey = legendBoard.GroupOptions.First(group => group.Areas.Contains(14)).Key;
        int affixPick = board.Arena.SpecialOptions.First(zone => zone.AreaId != defaultSpecial).AreaId;
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaGroups = new List<string> { physicalKey, lightningKey },
            ArenaSpecial = affixPick,
        });
        EndgameArenaTier pinnedTier = EndgameBuilder.Catalog(harness.Session).Arena.Tiers.Single(tier => tier.Id == legend);
        AssertEqual(physicalKey, pinnedTier.Groups[0].Key, "the first group pin fills zone slot 1");
        AssertEqual(lightningKey, pinnedTier.Groups[1].Key, "the second group pin fills zone slot 2");
        AssertEqual(affixPick, pinnedTier.SpecialZone!.AreaId, "the affix pin replaces the tier's Entropic zone");
        AssertEqual(true, pinnedTier.SpecialZone.Buffs.Count >= 2, "the pinned affix zone still names its two buffs");
        AssertEqual(true, pinnedTier.SpecialZone.Desc.Length > 0, "the pinned affix zone carries its archetype description");

        // A key the tier does not offer must never empty the week: the rotation fills the remaining slots.
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, ArenaGroups = new List<string> { "999|998" } });
        EndgameArenaTier fallbackTier = EndgameBuilder.Catalog(harness.Session).Arena.Tiers.Single(tier => tier.Id == legend);
        AssertEqual(2, fallbackTier.Groups.Count, "an unknown group pin still fills both zone slots");
        AssertEqual(true, fallbackTier.Groups.All(group => group.Key != "999|998"), "an unknown group pin is ignored");

        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest { Uid = playerId, ArenaGroups = new List<string>(), ArenaSpecial = 0 });
        EndgameCatalog clearedBoard = EndgameBuilder.Catalog(harness.Session);
        AssertEqual(0, clearedBoard.Arena.GroupOverride.Count, "an empty group list clears the pin");
        AssertEqual(0, clearedBoard.Arena.SpecialOverride, "a zero affix pin clears to the tier's zone");
        AssertEqual(defaultSpecial, clearedBoard.Arena.Tiers.Single(tier => tier.Id == legend).SpecialZone!.AreaId,
            "clearing the affix pin returns to the tier's ungrouped zone");

        // The curated Mob and Boss archetypes hydrate distinct wave shapes through the fight path.
        InvokeRegisteredRequestHandler("JoinActivityRequest", harness.Session, 88_2001, null);
        EndgameCatalog fightBoard = EndgameBuilder.Catalog(harness.Session);
        EndgameArenaTier fightTier = fightBoard.Arena.Tiers.Single(tier => tier.Id == legend);
        int mobArea = fightTier.Groups[0].Areas.First(areaId => fightBoard.Arena.AreaDetails[areaId].Desc.StartsWith("Joint Operation"));
        int bossArea = fightTier.Groups[1].Areas.First(areaId => fightBoard.Arena.AreaDetails[areaId].Desc.StartsWith("Desperate Fight"));
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaAreas = new Dictionary<string, int> { [fightTier.Groups[0].Key] = mobArea, [fightTier.Groups[1].Key] = bossArea },
        });
        Dictionary<int, AreaStageTable> fightAreas = TableReaderV2.Parse<AreaStageTable>().ToDictionary(row => row.Id);
        foreach ((int areaId, bool mob) in new[] { (mobArea, true), (bossArea, false) })
        {
            PreFightResponse response = new() { FightData = new PreFightResponse.PreFightResponseFightData() };
            AssertEqual(true, ArenaModule.ApplyPreFight(harness.Session, new PreFightRequest.PreFightRequestPreFightData
            {
                SelectAreaId = areaId,
                StageId = checked((uint)fightAreas[areaId].StageId[0]),
                ArenaSelectIndex = 0,
            }, response), mob ? "the Mob zone accepts a fight" : "the Boss zone accepts a fight");
            List<Dictionary<string, object>> waves = (List<Dictionary<string, object>>)response.FightData.NpcGroupList!;
            AssertEqual(99, waves.Count, mob ? "the Mob zone hydrates the captured 99-wave refresh" : "the Boss zone hydrates the captured 99-wave refresh");
            foreach (Dictionary<string, object> wave in waves)
            {
                List<object?> npcs = (List<object?>)wave["NpcList"];
                AssertEqual(true, mob ? npcs.Count >= 3 : npcs.Count == 1,
                    mob ? "a Mob wave refreshes a kroco pack" : "a Boss wave refreshes a single enemy");
                foreach (Dictionary<string, object?> npc in npcs.Cast<Dictionary<string, object?>>())
                    AssertEqual(true, Convert.ToInt64(npc["Level"]) >= 1, "hydrated NPC levels stay positive after scaling");
            }
        }

        static void DrainPushes(LoopbackSessionHarness harness)
        {
            for (int spin = 0; spin < 20; spin++)
            {
                while (harness.TryReadAvailablePacket("drain", out _)) { }
                Thread.Sleep(25);
            }
        }

        static bool SawPush(LoopbackSessionHarness harness, string name)
        {
            for (int spin = 0; spin < 40; spin++)
            {
                while (harness.TryReadAvailablePacket(name, out Packet packet))
                {
                    if (packet.Type == Packet.ContentType.Push && packet.Content is not null)
                    {
                        Packet.Push push = MessagePackSerializer.Deserialize<Packet.Push>(packet.Content);
                        if (push.Name == name)
                            return true;
                    }
                }
                Thread.Sleep(25);
            }
            return false;
        }

        static List<EndgameZoneGroup> CurrentGroups(EndgameCatalog catalog) =>
            catalog.Arena.Tiers.Single(tier => tier.Id == catalog.Arena.Current).Groups;
    }
}