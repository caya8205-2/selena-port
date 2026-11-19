using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.GameServer.Handlers;
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
        using LoopbackSessionHarness harness = new(roster, player, inventory, "tune-cub");

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
}