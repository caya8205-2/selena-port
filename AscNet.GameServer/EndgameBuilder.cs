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
            if (request.ArenaLevel is not null || request.ArenaAreas is not null
                || request.ArenaGroups is not null || request.ArenaSpecial is not null)
                Handlers.ArenaModule.ApplyAdminSelection(session, request);

            SimulatedBattlefieldState state = session.player.SimulatedBattlefield;

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

            if (request.ResetBossAttempts)
                Handlers.BossModule.ResetAdminAttempts(session);

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
            Dictionary<int, AreaStageTable> areaStages = TableReaderV2.Parse<AreaStageTable>().ToDictionary(row => row.Id);

            // Zones are tier-specific: the offered element groups and the Hero+ Entropic Distortion zone
            // both depend on the challenge a tier resolves to, so each tier carries its own board.
            List<EndgameArenaTier> tiers = TableReaderV2.Parse<ArenaLevelTable>()
                .OrderBy(row => row.Id)
                .Select(row => new EndgameArenaTier
                {
                    Id = row.Id,
                    Name = row.Name,
                    Groups = Handlers.ArenaModule.AdminOfferedZones(session, row.Id)
                        .Select(group => new EndgameZoneGroup
                        {
                            Key = group.Key,
                            Areas = group.Areas,
                            Chosen = group.Chosen,
                            Override = state.ArenaAreaOverride.GetValueOrDefault(group.Key, 0),
                        })
                        .ToList(),
                    GroupOptions = Handlers.ArenaModule.AdminGroupOptions(row.Id, playerLevel)
                        .Select(group => new EndgameZoneGroup { Key = group.Key, Areas = group.Areas })
                        .ToList(),
                    SpecialZone = ZoneInfo(Handlers.ArenaModule.AdminSpecialZone(session, row.Id), areaStages),
                })
                .ToList();

            List<EndgameZoneInfo> specialOptions = Handlers.ArenaModule.SupportedSpecialAreas()
                .Select(areaId => ZoneInfo(areaId, areaStages))
                .Where(zone => zone is not null)
                .Select(zone => zone!)
                .ToList();

            List<int> areaIds = tiers
                .SelectMany(tier => tier.Groups.SelectMany(group => group.Areas)
                    .Concat(tier.GroupOptions.SelectMany(group => group.Areas))
                    .Concat(tier.SpecialZone is null ? [] : new[] { tier.SpecialZone.AreaId }))
                .Concat(specialOptions.Select(zone => zone.AreaId))
                .Distinct()
                .Where(areaStages.ContainsKey)
                .ToList();

            EndgameArenaCatalog arena = new()
            {
                Current = state.ArenaLevel,
                Tiers = tiers,
                SpecialOptions = specialOptions,
                GroupOverride = new List<string>(state.ArenaGroupOverride),
                SpecialOverride = state.ArenaSpecialOverride,
                AreaNames = areaIds.ToDictionary(areaId => areaId, areaId => areaStages[areaId].Name),
                AreaDetails = areaIds
                    .Select(areaId => ZoneInfo(areaId, areaStages))
                    .Where(zone => zone is not null)
                    .Select(zone => zone!)
                    .ToDictionary(zone => zone.AreaId),
            };

            (int standard, int ultimate) = Handlers.BossModule.AdminGradeIds(playerLevel);
            List<EndgameBossGroup> standardGroups = BossGroups(session, standard);
            List<EndgameBossGroup> ultimateGroups = BossGroups(session, ultimate);
            EndgameBossCatalog boss = new()
            {
                Standard = standard,
                Ultimate = ultimate,
                Current = state.BossLevelType,
                StandardGroups = standardGroups,
                UltimateGroups = ultimateGroups,
                SectionNames = standardGroups.Concat(ultimateGroups)
                    .SelectMany(group => group.Sections)
                    .Distinct()
                    .Select(sectionId => (Id: sectionId, Name: Handlers.BossModule.AdminSectionBossName(sectionId)))
                    .Where(entry => entry.Name.Length > 0)
                    .ToDictionary(entry => entry.Id, entry => entry.Name),
            };

            return new EndgameCatalog { Arena = arena, Boss = boss };
        }

        // A zone row names its stage and the buffs it carries. The Entropic Distortion zone carries two
        // affix buffs and the client picks one per fight via ArenaSelectIndex, so the catalog only names
        // the options instead of persisting a choice.
        private static EndgameZoneInfo? ZoneInfo(int areaId, Dictionary<int, AreaStageTable> areaStages)
        {
            if (areaId <= 0 || !areaStages.TryGetValue(areaId, out AreaStageTable? area))
                return null;
            List<EndgameZoneBuff> buffs = [];
            for (int index = 0; index < area.BuffName.Count; index++)
            {
                if (string.IsNullOrWhiteSpace(area.BuffName[index]))
                    continue;
                buffs.Add(new EndgameZoneBuff
                {
                    Index = index + 1,
                    Name = area.BuffName[index],
                    Desc = index < area.BuffDesc.Count ? area.BuffDesc[index] : string.Empty,
                });
            }
            return new EndgameZoneInfo { AreaId = areaId, Name = area.Name, Desc = area.Desc, Buffs = buffs };
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
        /// <summary>Element group keys offered this week, in offer order. Null keeps, empty clears to rotation.</summary>
        public List<string>? ArenaGroups { get; set; }
        /// <summary>Entropic Distortion area pinned for Hero+ tiers. Null keeps, 0 clears to the tier's ungrouped area.</summary>
        public int? ArenaSpecial { get; set; }
        /// <summary>Boss pick per group (group id -> section id). Null keeps, empty clears to rotation.</summary>
        public Dictionary<int, int>? BossSections { get; set; }
        /// <summary>Refills today's Pain Cage attempts and construct stamina without touching score or picks.</summary>
        public bool ResetBossAttempts { get; set; }
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
        /// <summary>Every supported Entropic Distortion row an affix-zone pin may choose, with its two buffs.</summary>
        public List<EndgameZoneInfo> SpecialOptions { get; set; } = [];
        /// <summary>The stored element group pin, in offer order. Empty means the hash rotation.</summary>
        public List<string> GroupOverride { get; set; } = new();
        /// <summary>The stored Entropic Distortion pin. 0 means the tier's ungrouped area.</summary>
        public int SpecialOverride { get; set; }
        /// <summary>Area id -> AreaStage.Name for every area offered across the tiers.</summary>
        public Dictionary<int, string> AreaNames { get; set; } = new();
        /// <summary>Area id -> stage description and buffs, so a zone row can explain what it fights.</summary>
        public Dictionary<int, EndgameZoneInfo> AreaDetails { get; set; } = new();
    }

    public sealed class EndgameArenaTier
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        /// <summary>The element groups this tier offers this week, in selection order.</summary>
        public List<EndgameZoneGroup> Groups { get; set; } = [];
        /// <summary>Every element group this tier could offer, for the group pin pickers.</summary>
        public List<EndgameZoneGroup> GroupOptions { get; set; } = [];
        /// <summary>The Hero+ Entropic Distortion zone, null when the tier carries none.</summary>
        public EndgameZoneInfo? SpecialZone { get; set; }
    }

    public sealed class EndgameZoneInfo
    {
        public int AreaId { get; set; }
        public string Name { get; set; } = string.Empty;
        /// <summary>The AreaStage description of the encounter archetype.</summary>
        public string Desc { get; set; } = string.Empty;
        /// <summary>The buffs the zone carries; an Entropic Distortion zone carries two and the client picks one per fight.</summary>
        public List<EndgameZoneBuff> Buffs { get; set; } = [];
    }

    public sealed class EndgameZoneBuff
    {
        public int Index { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Desc { get; set; } = string.Empty;
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
        /// <summary>Section id -> the boss name the client shows, for every section the two grades offer.</summary>
        public Dictionary<int, string> SectionNames { get; set; } = new();
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