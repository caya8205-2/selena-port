using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.partner;
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

        int levelBefore = a.Level, qualityBefore = a.Quality, scheduleBefore = a.StarSchedule;
        TuneCubBulkReport asIs = TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest { Uid = playerId });
        AssertEqual(2, asIs.Applied, "as-is pass applies");
        AssertEqual(levelBefore, a.Level, "as-is keeps level");
        AssertEqual(qualityBefore, a.Quality, "as-is keeps quality");
        AssertEqual(scheduleBefore, a.StarSchedule, "as-is keeps star");

        TuneBuilder.ApplyCubBulk(harness.Session, new TuneCubBulkRequest { Uid = playerId, Level = 1, Star = 0 });
        AssertEqual(1, a.Level, "partial pass sets level");
        AssertEqual(0, a.StarSchedule, "partial pass clears star");
        AssertEqual(qualityBefore, a.Quality, "partial pass keeps quality");

        long coinAfter = inventory.Items.FirstOrDefault(i => i.Id == Inventory.Coin)?.Count ?? 0;
        AssertEqual(coinBefore, coinAfter, "design surface spends no coin");

        Character reloaded = BsonSerializer.Deserialize<Character>(harness.Session.character.ToBson());
        AssertEqual(a.Level, reloaded.Partners.First(p => p.Id == a.Id).Level, "bulk persists to the roster");
    }
}