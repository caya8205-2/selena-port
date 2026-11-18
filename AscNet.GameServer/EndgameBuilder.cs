using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.Table.V2.share.fuben.arena;
using AscNet.Table.V2.share.fuben.bosssingle;

namespace AscNet.GameServer
{
    /// <summary>
    /// Endgame control: jump the War Zone / Pain Cage rank directly and pick this week's zones and bosses.
    /// <para>
    /// A design surface like the construct tune. The caller states the rank and the weekly picks it wants;
    /// the tables decide what is legal. Nothing is spent and no capture is read. A null field keeps the
    /// current value; an empty pick dictionary clears the override back to the hash rotation.
    /// </para>
    /// </summary>
    public static class EndgameBuilder
    {
        public static EndgameApplyReport Apply(Session session, EndgameApplyRequest request)
        {
            if (request.ArenaLevel is int arenaLevel)
                Handlers.ArenaModule.ApplyAdminTier(session, arenaLevel);

            SimulatedBattlefieldState state = session.player.SimulatedBattlefield;

            bool arenaOverrideChanged = false;
            if (request.ArenaAreas is not null)
            {
                state.ArenaAreaOverride = new Dictionary<string, int>(request.ArenaAreas);
                arenaOverrideChanged = true;
            }

            bool bossOverrideChanged = false;
            if (request.BossSections is not null)
            {
                state.BossSectionOverride = new Dictionary<int, int>(request.BossSections);
                bossOverrideChanged = true;
            }

            // The boss list is rebuilt from the override, so set the override before the level-type apply.
            if (request.BossLevelType is int bossLevelType)
                Handlers.BossModule.ApplyAdminLevelType(session, bossLevelType);
            else if (bossOverrideChanged)
                Handlers.BossModule.RefreshAdminBossList(session);

            if (arenaOverrideChanged)
                session.player.Save();

            state = session.player.SimulatedBattlefield;
            return new EndgameApplyReport
            {
                ArenaLevel = state.ArenaLevel,
                BossLevelType = state.BossLevelType,
                ArenaAreas = new Dictionary<string, int>(state.ArenaAreaOverride),
                BossSections = new Dictionary<int, int>(state.BossSectionOverride),
            };
        }

        public static EndgameCatalog Catalog(Session session)
        {
            // A player who never joined the arena still has tier 0; initialize it the way login would so
            // the catalog reads a real challenge instead of throwing.
            Handlers.ArenaModule.EnsureCurrent(session.player);
            SimulatedBattlefieldState state = session.player.SimulatedBattlefield;
            int playerLevel = checked((int)session.player.PlayerData.Level);

            List<EndgameZoneGroup> zoneGroups = Handlers.ArenaModule.AdminOfferedZones(session)
                .Select(group => new EndgameZoneGroup
                {
                    Key = group.Key,
                    Areas = group.Areas,
                    Chosen = group.Chosen,
                    Override = state.ArenaAreaOverride.GetValueOrDefault(group.Key, 0),
                })
                .ToList();

            Dictionary<int, AreaStageTable> areaStages = TableReaderV2.Parse<AreaStageTable>().ToDictionary(row => row.Id);
            EndgameArenaCatalog arena = new()
            {
                Current = state.ArenaLevel,
                Tiers = TableReaderV2.Parse<ArenaLevelTable>()
                    .OrderBy(row => row.Id)
                    .Select(row => new EndgameArenaTier { Id = row.Id, Name = row.Name })
                    .ToList(),
                Groups = zoneGroups,
                AreaNames = zoneGroups
                    .SelectMany(group => group.Areas)
                    .Distinct()
                    .Where(areaStages.ContainsKey)
                    .ToDictionary(areaId => areaId, areaId => areaStages[areaId].Name),
            };

            (int standard, int ultimate) = Handlers.BossModule.AdminGradeIds(playerLevel);
            EndgameBossCatalog boss = new()
            {
                Standard = standard,
                Ultimate = ultimate,
                Current = state.BossLevelType,
                StandardGroups = BossGroups(session, standard),
                UltimateGroups = BossGroups(session, ultimate),
            };

            return new EndgameCatalog { Arena = arena, Boss = boss };
        }

        private static List<EndgameBossGroup> BossGroups(Session session, int levelType)
        {
            SimulatedBattlefieldState state = session.player.SimulatedBattlefield;
            List<(int GroupId, List<int> Sections)> groups = Handlers.BossModule.AdminBossGroupsFor(levelType);
            // BossList is ordered by the grade's GroupId, so index i is the pick for group i — but only
            // while that grade is the one actually selected. Otherwise only a stored override is a pick.
            bool active = state.BossLevelType == levelType;
            return groups.Select((group, index) =>
            {
                int stored = state.BossSectionOverride.GetValueOrDefault(group.GroupId, 0);
                return new EndgameBossGroup
                {
                    Id = group.GroupId,
                    Sections = group.Sections,
                    Override = stored,
                    Chosen = stored > 0 ? stored : active && index < state.BossList.Count ? state.BossList[index] : 0,
                };
            }).ToList();
        }
    }

    public sealed class EndgameApplyRequest
    {
        public long Uid { get; set; }
        /// <summary>War Zone tier id (ArenaLevel.tsv); null keeps the current tier.</summary>
        public int? ArenaLevel { get; set; }
        /// <summary>Pain Cage grade id (BossSingleGrade.tsv); null keeps the current grade.</summary>
        public int? BossLevelType { get; set; }
        /// <summary>Zone pick per element group (group key -> area id). Null keeps, empty clears to rotation.</summary>
        public Dictionary<string, int>? ArenaAreas { get; set; }
        /// <summary>Boss pick per group (group id -> section id). Null keeps, empty clears to rotation.</summary>
        public Dictionary<int, int>? BossSections { get; set; }
    }

    public sealed class EndgameApplyReport
    {
        public int ArenaLevel { get; set; }
        public int BossLevelType { get; set; }
        public Dictionary<string, int> ArenaAreas { get; set; } = new();
        public Dictionary<int, int> BossSections { get; set; } = new();
    }

    public sealed class EndgameCatalog
    {
        public EndgameArenaCatalog Arena { get; set; } = new();
        public EndgameBossCatalog Boss { get; set; } = new();
    }

    public sealed class EndgameArenaCatalog
    {
        public List<EndgameArenaTier> Tiers { get; set; } = [];
        public int Current { get; set; }
        public List<EndgameZoneGroup> Groups { get; set; } = [];
        /// <summary>Area id -> AreaStage.Name for the areas offered this week.</summary>
        public Dictionary<int, string> AreaNames { get; set; } = new();
    }

    public sealed class EndgameArenaTier
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }

    public sealed class EndgameZoneGroup
    {
        public string Key { get; set; } = string.Empty;
        public List<int> Areas { get; set; } = [];
        /// <summary>The area actually on the board this week (override if set, otherwise the rotation).</summary>
        public int Chosen { get; set; }
        /// <summary>The stored admin pick, 0 when the group is left to the rotation.</summary>
        public int Override { get; set; }
    }

    public sealed class EndgameBossCatalog
    {
        public int Standard { get; set; }
        public int Ultimate { get; set; }
        public int Current { get; set; }
        public List<EndgameBossGroup> StandardGroups { get; set; } = [];
        public List<EndgameBossGroup> UltimateGroups { get; set; } = [];
    }

    public sealed class EndgameBossGroup
    {
        public int Id { get; set; }
        public List<int> Sections { get; set; } = [];
        /// <summary>The section actually on the board this week (override if set, otherwise the rotation).</summary>
        public int Chosen { get; set; }
        /// <summary>The stored admin pick, 0 when the group is left to the rotation.</summary>
        public int Override { get; set; }
    }
}