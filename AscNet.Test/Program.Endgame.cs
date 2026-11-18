using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.Table.V2.share.fuben.bosssingle;
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
        AssertEqual(true, after.Arena.Groups.Count > 0, "weekly zone groups are offered");
        AssertEqual(true, after.Boss.UltimateGroups.Count > 0, "ultimate boss groups are offered");

        // The curated stage dataset currently supports one area per element group, so a zone pick may have
        // no alternative; take a differing area when the group offers one, otherwise the supported area itself.
        EndgameZoneGroup zone = after.Arena.Groups[0];
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
        AssertEqual(zonePick, pickedCatalog.Arena.Groups.First(group => group.Key == zone.Key).Chosen,
            "the weekly zone honors the admin pick");
        AssertEqual(bossPick, player.SimulatedBattlefield.BossList[bossIndex],
            "the weekly boss list honors the admin pick");

        // A pick the group does not support must never empty the week: it falls back to the rotation.
        EndgameBuilder.Apply(harness.Session, new EndgameApplyRequest
        {
            Uid = playerId,
            ArenaAreas = new Dictionary<string, int> { [zone.Key] = unsupportedArea },
        });
        AssertEqual(zone.Chosen, EndgameBuilder.Catalog(harness.Session).Arena.Groups.First(group => group.Key == zone.Key).Chosen,
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
        AssertEqual(true, clearedCatalog.Arena.Groups.First(group => group.Key == zone.Key).Chosen != zonePick
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
    }
}