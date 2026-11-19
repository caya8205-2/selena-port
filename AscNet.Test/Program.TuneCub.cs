using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.character;
using AscNet.Table.V2.share.config;
using AscNet.Table.V2.share.partner;
using MessagePack;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace AscNet.Test;

internal partial class Program
{
    private static void ValidateTuneCubBulk()
    {
        const long playerId = 99_660;
        Player player = CreateDrawCompatibilityPlayer(playerId);
        Inventory inventory = CreateDrawCompatibilityInventory(playerId, []);
        Character roster = CreateDrawCompatibilityCharacter(playerId);
        roster.Characters = [];
        roster.Equips = [];
        roster.Partners = [];
        using MongoCollectionOverride mongo = MongoCollectionOverride.InstallForDailySignInCompatibility(out _, out _, out _);
        using LoopbackSessionHarness harness = new(roster, player, inventory, "tune-cub", startClientLoop: false);

        List<PartnerTable> templates = TableReaderV2.Parse<PartnerTable>()
            .Where(t => TableReaderV2.Parse<PartnerBreakThroughTable>().Count(r => r.PartnerId == t.Id) >= 2
                && TableReaderV2.Parse<PartnerQualityTable>().Count(r => r.PartnerId == t.Id) >= 2)
            .Take(2).ToList();
        AssertEqual(true, templates.Count == 2, "two CUB templates with breakthrough and quality ladders");

        PartnerData a = PartnerModule.CreatePartner(1, templates[0].Id);
        PartnerData b = PartnerModule.CreatePartner(2, templates[1].Id);
        roster.Partners = [a, b];
        long coinBefore = inventory.Items.FirstOrDefault(i => i.Id == Inventory.Coin)?.Count ?? 0;

        TuneCubBulkReport maxed = TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest
        {
            Uid = playerId, Level = 999, BreakThrough = 99, Quality = 99, Star = 99, SkillLevel = 99
        });
        AssertEqual(2, maxed.Total, "bulk counts every owned CUB");
        AssertEqual(2, maxed.Applied, "both CUBs applied");
        AssertEqual(0, maxed.Failed.Count, "no failures on the max pass");

        foreach (PartnerData p in new[] { a, b })
        {
            int maxBreak = TableReaderV2.Parse<PartnerBreakThroughTable>()
                .Where(r => r.PartnerId == p.TemplateId).Max(r => r.BreakTimes);
            PartnerBreakThroughTable stage = TableReaderV2.Parse<PartnerBreakThroughTable>()
                .First(r => r.PartnerId == p.TemplateId && r.BreakTimes == maxBreak);
            int maxQuality = TableReaderV2.Parse<PartnerQualityTable>()
                .Where(r => r.PartnerId == p.TemplateId).Max(r => r.Quality);
            int maxSchedule = TableReaderV2.Parse<PartnerQualityTable>()
                .First(r => r.PartnerId == p.TemplateId && r.Quality == maxQuality)
                .StarCostChipCount.LastOrDefault(v => v > 0);
            AssertEqual(maxBreak, p.BreakThrough, "breakthrough at its own table cap");
            AssertEqual(stage.LevelLimit, p.Level, "level at the cap breakthrough's limit");
            AssertEqual(0, p.Exp, "exp cleared at cap");
            AssertEqual(maxQuality, p.Quality, "quality at its own table cap");
            AssertEqual(maxSchedule, p.StarSchedule, "star schedule at the quality cap");
            foreach (PartnerSkillData s in p.SkillList)
            {
                int ceiling = TableReaderV2.Parse<PartnerSkillEffectTable>()
                    .Where(e => e.SkillId == s.Id).Select(e => e.Level).DefaultIfEmpty(0).Max();
                if (ceiling > 0)
                    AssertEqual(ceiling, s.Level, "skill at its effect ceiling");
            }
        }

        NotifyPartnerDataList maxedPush = ReadCubPartnerPush("maxed");
        AssertEqual(2, maxedPush.PartnerDataList.Count, "maxed push carries every tuned copy");
        AssertEqual(true, maxedPush.OperateTypes.All(t => t == 2), "maxed push marks updates");

        int levelBefore = a.Level, qualityBefore = a.Quality, scheduleBefore = a.StarSchedule;
        TuneCubBulkReport asIs = TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest { Uid = playerId });
        AssertEqual(2, asIs.Applied, "as-is pass applies");
        AssertEqual(levelBefore, a.Level, "as-is keeps level");
        AssertEqual(qualityBefore, a.Quality, "as-is keeps quality");
        AssertEqual(scheduleBefore, a.StarSchedule, "as-is keeps star");
        AssertEqual(2, ReadCubPartnerPush("as-is").PartnerDataList.Count, "as-is push carries both copies");

        TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest { Uid = playerId, Level = 1, Star = 0 });
        AssertEqual(1, a.Level, "partial pass sets level");
        AssertEqual(0, a.StarSchedule, "partial pass clears star");
        AssertEqual(qualityBefore, a.Quality, "partial pass keeps quality");
        AssertEqual(2, ReadCubPartnerPush("partial").PartnerDataList.Count, "partial push carries both copies");

        // A named PartnerId narrows the write to one CUB; the other keeps its state.
        int bLevelBefore = b.Level, bQualityBefore = b.Quality;
        TuneCubBulkReport single = TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest
        {
            Uid = playerId, PartnerId = a.TemplateId, Level = 5
        });
        AssertEqual(1, single.Total, "single tune counts only the named CUB");
        AssertEqual(1, single.Applied, "single tune applies one");
        AssertEqual(5, a.Level, "single tune sets the named CUB level");
        AssertEqual(qualityBefore, a.Quality, "single tune keeps the named CUB quality");
        AssertEqual(bLevelBefore, b.Level, "single tune leaves the other CUB level");
        AssertEqual(bQualityBefore, b.Quality, "single tune leaves the other CUB quality");
        NotifyPartnerDataList singlePush = ReadCubPartnerPush("single");
        AssertEqual(1, singlePush.PartnerDataList.Count, "single push carries only the named CUB's copies");
        AssertEqual(a.Id, singlePush.PartnerDataList[0].Id, "single push names the tuned copy");

        // Rank walks the CUB's own quality ladder; a level request implies its breakthrough stage.
        List<int> bLadder = TableReaderV2.Parse<PartnerQualityTable>()
            .Where(r => r.PartnerId == b.TemplateId).Select(r => r.Quality).Distinct().OrderBy(v => v).ToList();
        int bMaxLevel = TableReaderV2.Parse<PartnerBreakThroughTable>()
            .Where(r => r.PartnerId == b.TemplateId).Max(r => r.LevelLimit);
        int bMaxBreak = TableReaderV2.Parse<PartnerBreakThroughTable>()
            .Where(r => r.PartnerId == b.TemplateId).Max(r => r.BreakTimes);
        TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest
        {
            Uid = playerId, PartnerId = b.TemplateId, RankStep = 1, Level = bMaxLevel
        });
        AssertEqual(bLadder[0], b.Quality, "rank step 1 lands on the ladder bottom");
        AssertEqual(bMaxBreak, b.BreakThrough, "level implies the breakthrough that reaches it");
        AssertEqual(bMaxLevel, b.Level, "level reaches the table cap");
        AssertEqual(1, ReadCubPartnerPush("rank bottom").PartnerDataList.Count, "rank push carries one copy");
        TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest
        {
            Uid = playerId, PartnerId = b.TemplateId, RankStep = bLadder.Count
        });
        AssertEqual(bLadder[^1], b.Quality, "rank step at ladder count lands on top");
        AssertEqual(1, ReadCubPartnerPush("rank top").PartnerDataList.Count, "rank top push carries one copy");

        TuneCubStateReport state = TuneBuilder.CubState(harness.Session);
        AssertEqual(2, state.Cubs.Count, "state lists every owned CUB");
        TuneCubStateEntry entryA = state.Cubs.First(c => c.TemplateId == a.TemplateId);
        AssertEqual(a.Level, entryA.Level, "state mirrors the current level");
        AssertEqual(true, entryA.MaxLevel >= entryA.Level, "state level cap bounds the current level");
        AssertEqual(true, entryA.MaxBreak >= 1, "state exposes a breakthrough cap");
        AssertEqual(a.SkillList.Count, entryA.Skills.Count, "state lists every skill");

        long coinAfter = inventory.Items.FirstOrDefault(i => i.Id == Inventory.Coin)?.Count ?? 0;
        AssertEqual(coinBefore, coinAfter, "design surface spends no coin");

        Character reloaded = BsonSerializer.Deserialize<Character>(harness.Session.character.ToBson());
        AssertEqual(a.Level, reloaded.Partners.First(p => p.Id == a.Id).Level, "bulk persists to the roster");

        ValidateTuneCubPassiveReconciliation();

        NotifyPartnerDataList ReadCubPartnerPush(string name)
        {
            for (int i = 0; i < 4; i++)
            {
                Packet packet = harness.ReadPacket($"{name} push {i + 1}");
                AssertEqual(Packet.ContentType.Push, packet.Type, $"{name} push type");
                Packet.Push push = MessagePackSerializer.Deserialize<Packet.Push>(packet.Content);
                if (push.Name is nameof(NotifyArchivePartners) or nameof(NotifyPartnerSettings))
                    continue;
                AssertEqual(nameof(NotifyPartnerDataList), push.Name, $"{name} push name");
                return MessagePackSerializer.Deserialize<NotifyPartnerDataList>(push.Content);
            }
            throw new InvalidDataException($"{name}: expected a partner push");
        }
    }

    private static void ValidateTuneCubPassiveReconciliation()
    {
        const long uid = 99_661;
        List<PartnerQualityTable> qualities = TableReaderV2.Parse<PartnerQualityTable>();
        // Confirmed Vulpecula regression: four selections survive a tune to quality 3 (two slots).
        var fixture = TableReaderV2.Parse<PartnerTable>()
            .Where(template => template.Name == "Vulpecula")
            .Select(template => new
            {
                Partner = PartnerModule.CreatePartner(11, template.Id),
                Rows = qualities.Where(row => row.PartnerId == template.Id && row.Quality is 3 or 5)
                    .OrderBy(row => row.Quality).ToList()
            })
            .First(value => value.Rows.Count > 1 && value.Rows[0].SkillColumnCount > 0
                && value.Rows[^1].SkillColumnCount > value.Rows[0].SkillColumnCount
                && value.Partner.SkillList.Count(skill => skill.Type == 2) >= value.Rows[^1].SkillColumnCount);
        PartnerData tuned = fixture.Partner;
        PartnerQualityTable bottom = fixture.Rows[0], top = fixture.Rows[^1];
        PartnerData other = PartnerModule.CreatePartner(12,
            TableReaderV2.Parse<PartnerTable>().First(row => row.Id != tuned.TemplateId).Id);
        int[] fullPassives = tuned.SkillList.Where(skill => skill.Type == 2)
            .Take(top.SkillColumnCount).Select(skill => skill.Id).ToArray();
        // Non-sorted order distinguishes retaining selections from sorting/rebuilding the learned pool.
        tuned.SkillList.Reverse();
        int[] wornOrder = tuned.SkillList.Where(skill => fullPassives.Contains(skill.Id))
            .Select(skill => skill.Id).ToArray();
        int[] presetOrder = wornOrder.Reverse().ToArray();
        int characterId = TableReaderV2.Parse<CharacterTable>().First(row => row.Type == 1).Id;
        int positions = TableReaderV2.Parse<TeamConfigTable>().First(row => row.Key == "TeamMaxPos").Value;
        Character roster = CreateDrawCompatibilityCharacter(uid);
        roster.Characters = [new CharacterData { Id = (uint)characterId }];
        roster.Equips = [];
        roster.Partners = [tuned, other];
        Player player = CreateDrawCompatibilityPlayer(uid);
        TeamPrefabData saved = Preset(1, tuned, presetOrder);
        TeamPrefabData second = Preset(2, tuned, wornOrder);
        TeamPrefabData unrelated = Preset(3, other, []);
        player.TeamPrefabs = [saved, second, unrelated];
        string unrelatedBefore = Hex(unrelated);
        string otherBefore = Hex(other);
        string learnedBefore = Learned(tuned);
        string unlockedBefore = string.Join(",", tuned.UnlockSkillGroup);
        tuned.Quality = top.Quality;
        PartnerModule.RefreshArchive(player, roster);
        using MongoCollectionOverride mongo = MongoCollectionOverride.InstallForDailySignInCompatibility(
            out RecordingMongoCollectionProxy<Player> players,
            out RecordingMongoCollectionProxy<Character> characters, out _);
        using LoopbackSessionHarness harness = new(roster, player,
            CreateDrawCompatibilityInventory(uid, []), "tune-cub-passives", startClientLoop: false);

        foreach (string scenario in new[] { "downgrade", "same-quality recovery", "preset-only recovery", "repeat" })
        {
            bool repeat = scenario == "repeat";
            if (!repeat)
            {
                tuned.Quality = scenario == "downgrade" ? top.Quality : bottom.Quality;
                foreach (PartnerSkillData skill in tuned.SkillList.Where(skill => skill.Type == 2))
                    skill.IsWear = (scenario == "preset-only recovery" ? wornOrder.Take(bottom.SkillColumnCount) : wornOrder)
                        .Contains(skill.Id);
                saved.PartnerData[1]!.SkillData![2] = presetOrder.ToList();
                second.PartnerData[1]!.SkillData![2] = wornOrder.ToList();
            }
            int playerSaves = players.ReplaceOneCalls, characterSaves = characters.ReplaceOneCalls;
            TuneCubBulkReport report = TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest
            {
                Uid = uid, PartnerId = tuned.TemplateId,
                Quality = scenario == "downgrade" ? bottom.Quality : null
            });
            AssertEqual(1, report.Applied, $"{scenario}: one tuned instance");
            AssertEqual(0, report.Failed.Count, $"{scenario}: no tuning failure");
            AssertEqual(bottom.Quality, tuned.Quality, $"{scenario}: bottom quality");
            AssertEqual(string.Join(",", wornOrder.Take(bottom.SkillColumnCount)), Worn(tuned),
                $"{scenario}: equipped passives retain their first table-cap entries");
            AssertEqual(string.Join(",", presetOrder.Take(bottom.SkillColumnCount)),
                string.Join(",", saved.PartnerData[1]!.SkillData![2]), $"{scenario}: preset keeps its own ordering");
            AssertEqual(string.Join(",", wornOrder.Take(bottom.SkillColumnCount)),
                string.Join(",", second.PartnerData[1]!.SkillData![2]), $"{scenario}: every matching preset repaired");
            AssertEqual(learnedBefore, Learned(tuned), $"{scenario}: learned skills and levels retained");
            AssertEqual(unlockedBefore, string.Join(",", tuned.UnlockSkillGroup), $"{scenario}: unlocks retained");
            AssertEqual(otherBefore, Hex(other), $"{scenario}: other CUB untouched");
            AssertEqual(unrelatedBefore, Hex(unrelated), $"{scenario}: unrelated preset untouched");
            AssertEqual(characterSaves + 1, characters.ReplaceOneCalls, $"{scenario}: Character saved");
            AssertEqual(playerSaves + (repeat ? 0 : 1), players.ReplaceOneCalls, $"{scenario}: Player saved only for repaired presets");

            NotifyPartnerDataList push = ReadPushPayload<NotifyPartnerDataList>(harness,
                nameof(NotifyPartnerDataList), $"{scenario}: updated partner push");
            AssertEqual(1, push.PartnerDataList.Count, $"{scenario}: only tuned CUB pushed");
            AssertEqual(tuned.Id, push.PartnerDataList[0].Id, $"{scenario}: push identifies tuned instance");
            AssertEqual(bottom.Quality, push.PartnerDataList[0].Quality, $"{scenario}: pushed quality");
            AssertEqual(Worn(tuned), Worn(push.PartnerDataList[0]), $"{scenario}: pushed corrected selections");
            AssertEqual(true, push.OperateTypes.SequenceEqual(new[] { 2 }), $"{scenario}: update operation");
            // Client only hydrates TeamPrefabData from NotifyLogin; no standalone preset refresh RPC exists.
            AssertNoPendingPacket(harness, $"{scenario}: no invented TeamPrefab push");
            Character reloaded = BsonSerializer.Deserialize<Character>(characters.LastSuccessfulReplacementBson!);
            Player reloadedPlayer = BsonSerializer.Deserialize<Player>(players.LastSuccessfulReplacementBson!);
            AssertEqual(Hex(tuned), Hex(reloaded.Partners.Single(row => row.Id == tuned.Id)),
                $"{scenario}: corrected CUB BSON persisted");
            AssertEqual(Hex(saved), Hex(reloadedPlayer.TeamPrefabs.Single(row => row.TeamId == saved.TeamId)),
                $"{scenario}: corrected preset BSON persisted");
            AssertEqual(Hex(second), Hex(reloadedPlayer.TeamPrefabs.Single(row => row.TeamId == second.TeamId)),
                $"{scenario}: second preset BSON persisted");
            AssertEqual(unrelatedBefore, Hex(reloadedPlayer.TeamPrefabs.Single(row => row.TeamId == unrelated.TeamId)),
                $"{scenario}: unrelated preset BSON retained");
        }

        InvokeRequestHandler(harness, nameof(TeamPrefabApplyRequest), 996_610,
            new TeamPrefabApplyRequest { TeamId = saved.TeamId });
        NotifyPartnerDataList applied = ReadPushPayload<NotifyPartnerDataList>(harness,
            nameof(NotifyPartnerDataList), "repaired preset apply partner push");
        AssertEqual(true, applied.PartnerDataList.Single().SkillList.Where(skill => skill.Type == 2 && skill.IsWear)
            .Select(skill => skill.Id).ToHashSet().SetEquals(presetOrder.Take(bottom.SkillColumnCount)),
            "apply uses the preset's retained selection, not the formerly equipped selection");
        ReadPushPayload<NotifyEquipDataList>(harness, nameof(NotifyEquipDataList), "preset apply equipment push");
        AssertEqual(0, ReadResponsePayload<TeamPrefabApplyRequestResponse>(harness, 996_610,
            nameof(TeamPrefabApplyRequestResponse), "repaired preset apply").Code, "repaired preset applies");

        TeamPrefabData fresh = Preset(4, tuned,
            tuned.SkillList.Where(skill => skill.Type == 2 && skill.IsWear).Select(skill => skill.Id));
        InvokeRequestHandler(harness, nameof(TeamPrefabSetTeamRequest), 996_611,
            new TeamPrefabSetTeamRequest { TeamPrefabData = fresh });
        AssertEqual(0, ReadResponsePayload<TeamPrefabSetTeamResponse>(harness, 996_611,
            nameof(TeamPrefabSetTeamResponse), "new save after tune").Code, "current tuned selections save successfully");

        int savesBeforeInvalid = players.ReplaceOneCalls;
        fresh.PartnerData[1]!.SkillData![2] = fullPassives.ToList();
        AssertEqual(false, FightModule.IsValidPartnerSkillData(tuned, fresh.PartnerData[1]!.SkillData, out var failure),
            "oversized incoming selection remains invalid");
        AssertEqual(FightModule.TeamPrefabValidationFailure.TooManyPartnerPassiveSkills, failure,
            "incoming rejection specifically enforces quality cap");
        InvokeRequestHandler(harness, nameof(TeamPrefabSetTeamRequest), 996_612,
            new TeamPrefabSetTeamRequest { TeamPrefabData = fresh });
        AssertEqual(20004003, ReadResponsePayload<TeamPrefabSetTeamResponse>(harness, 996_612,
            nameof(TeamPrefabSetTeamResponse), "invalid save after tune").Code, "arbitrary incoming overflow is not truncated");
        AssertEqual(savesBeforeInvalid, players.ReplaceOneCalls, "invalid incoming preset does not save");
        AssertEqual(otherBefore, Hex(other), "preset apply and saves leave the other CUB alone");

        TeamPrefabData Preset(int id, PartnerData partner, IEnumerable<int> passives) => new()
        {
            TeamType = TeamKind.Prefab, TeamId = id, TeamName = $"CUB tune {id}", CaptainPos = 1, FirstFightPos = 1,
            TeamData = Enumerable.Range(1, positions).ToDictionary(pos => pos, pos => pos == 1 ? characterId : 0),
            PartnerData = new()
            {
                [1] = new TeamPrefabPartnerData
                {
                    PartnerId = partner.Id,
                    SkillData = new()
                    {
                        [1] = [TableReaderV2.Parse<PartnerMainSkillGroupTable>()
                            .Single(group => group.SkillId.Contains(partner.SkillList.First(skill => skill.Type == 1 && skill.IsWear).Id))
                            .SkillId.First()],
                        [2] = passives.ToList()
                    }
                }
            }
        };
        static string Worn(PartnerData partner) => string.Join(",",
            partner.SkillList.Where(skill => skill.Type == 2 && skill.IsWear).Select(skill => skill.Id));
        static string Learned(PartnerData partner) => string.Join(";",
            partner.SkillList.Select(skill => $"{skill.Type}:{skill.Id}:{skill.Level}"));
        static string Hex<T>(T value) => Convert.ToHexString(value.ToBson());
    }
}