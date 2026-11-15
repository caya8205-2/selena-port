using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.Table.V2.share.config;
using AscNet.Table.V2.share.dormitory;
using AscNet.Table.V2.share.dormitory.furniture;
using Newtonsoft.Json.Linq;

namespace AscNet.Test
{
    internal partial class Program
    {
        /// <summary>
        /// The dorm panel's command surface. `info` must describe the account without writing
        /// anything, and `fill` must grant exactly what the tables name for a room and nothing on a
        /// second run. The expected sets are recomputed here from the same tables, so a command that
        /// invents an offer or skips a piece fails the comparison.
        /// </summary>
        private static void ValidateDormBuilderCompatibility()
        {
            AscNet.GameServer.Commands.CommandFactory.LoadCommands();
            AscNet.GameServer.PacketFactory.LoadPacketHandlers();
            AssertEqual(true, AscNet.GameServer.Commands.CommandFactory.commands.ContainsKey("dorm"),
                "dorm builder registers the dorm command");

            List<FurnitureTable> furnitureRows = TableReaderV2.Parse<FurnitureTable>();
            HashSet<int> furnitureConfigs = furnitureRows.Select(row => row.Id).ToHashSet();
            Dictionary<int, int> rewardByConfig = TableReaderV2.Parse<FurnitureRewardTable>()
                .Where(row => furnitureConfigs.Contains(row.FurnitureId))
                .GroupBy(row => row.FurnitureId)
                .ToDictionary(group => group.Key, group => group.Min(row => row.Id));
            List<DormTemplateTable> templates = TableReaderV2.Parse<DormTemplateTable>();
            List<DormitoryTable> dormitories = TableReaderV2.Parse<DormitoryTable>();
            DormitoryTable freeRoom = dormitories.First(row => row.IsFree == 1);
            DormitoryTable paidRoom = dormitories.First(row => row.IsFree != 1 && row.ConsumeItemId is > 0 && row.ConsumeItemCount is > 0);
            DormTemplateTable template = templates.First(row => TemplatePieces(row).Count > 1
                && TemplatePieces(row).All(rewardByConfig.ContainsKey));
            List<int> templatePieces = TemplatePieces(template).Where(rewardByConfig.ContainsKey).Order().ToList();
            List<int> everyGrantable = furnitureRows
                .Select(row => row.Id)
                .Where(rewardByConfig.ContainsKey)
                .Order().ToList();
            int furnitureCap = DormFurnitureCap();

            using MongoCollectionOverride mongo = MongoCollectionOverride.InstallForDailySignInCompatibility(
                out RecordingMongoCollectionProxy<AscNet.Common.Database.Player> playerSaves, out _, out _);

            // ---- info: a player holding one free room and no furniture.
            long infoUid = 90_6701;
            AscNet.Common.Database.Player infoPlayer = DormBuilderPlayer(infoUid, [freeRoom.Id]);
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(infoUid), infoPlayer,
                CreateDrawCompatibilityInventory(infoUid, []), "dorm-builder-info"))
            {
                int savesBeforeInfo = playerSaves.ReplaceOneCalls;
                JObject info = RunDormCommand(harness, "info");
                AssertEqual(false, info["ok"] is null || !info["ok"]!.Value<bool>(), "dorm info ok");
                AssertEqual(furnitureRows.Count, info["missing"]!["total"]!.Value<int>(), "dorm info lists every unowned template");
                AssertEqual(rewardByConfig.Count, info["missing"]!["grantable"]!.Value<int>(),
                    "dorm info splits the grantable templates");
                AssertEqual(furnitureRows.Count - rewardByConfig.Count, info["missing"]!["unpurchasable"]!.Value<int>(),
                    "dorm info counts the templates no furniture reward names");
                AssertEqual(0, ((JArray)info["owned"]!).Count, "dorm info reports no owned furniture");
                AssertEqual(1, ((JArray)info["rooms"]!).Count, "dorm info reports the held room");
                AssertEqual(freeRoom.Id, info["rooms"]![0]!["roomId"]!.Value<int>(), "dorm info room id");
                AssertEqual(templates.Count, ((JArray)info["templates"]!).Count, "dorm info reports every room template");
                AssertEqual(savesBeforeInfo, playerSaves.ReplaceOneCalls, "dorm info writes nothing");
            }

            // ---- fill a room template, then the same fill again.
            long templateUid = 90_6702;
            AscNet.Common.Database.Player templatePlayer = DormBuilderPlayer(templateUid, [freeRoom.Id]);
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(templateUid), templatePlayer,
                CreateDrawCompatibilityInventory(templateUid, []), "dorm-builder-template"))
            {
                JObject filled = RunDormCommand(harness, "fill", template.Id.ToString());
                AssertEqual("template", filled["scope"]!.Value<string>(), "dorm fill template scope");
                AssertEqual(templatePieces.Count, filled["grantedCount"]!.Value<int>(), "dorm fill template grants every missing piece");
                AssertEqual(templatePieces.Count, templatePlayer.Dorm.Furniture.Count, "dorm fill template stores one instance per piece");
                AssertIntegerList(templatePieces.Select(piece => (long)piece).ToArray(),
                    templatePlayer.Dorm.Furniture.Select(entry => (long)entry.ConfigId).Order().ToArray(),
                    "dorm fill template grants only table pieces");
                AssertEqual(true, templatePlayer.Dorm.Furniture.All(entry => entry.DormitoryId <= 0),
                    "dorm fill leaves placement to the client");
                AssertEqual(true, templatePieces.All(piece => templatePlayer.Dorm.FurnitureUnlocks.Contains((uint)piece)),
                    "dorm fill unlocks every granted piece");
                AssertEqual(true, playerSaves.ReplaceOneCalls > 0, "dorm fill persists the player");

                int savesAfterFirstFill = playerSaves.ReplaceOneCalls;
                JObject repeat = RunDormCommand(harness, "fill", template.Id.ToString());
                AssertEqual(0, repeat["grantedCount"]!.Value<int>(), "dorm fill second run grants nothing");
                AssertEqual(templatePieces.Count, templatePlayer.Dorm.Furniture.Count, "dorm fill second run stores nothing");
                AssertEqual(savesAfterFirstFill, playerSaves.ReplaceOneCalls, "dorm fill second run writes nothing");

                JObject room = RunDormCommand(harness, "fill", freeRoom.Id.ToString());
                AssertEqual("room", room["scope"]!.Value<string>(), "dorm fill room scope");
                AssertEqual(0, room["grantedCount"]!.Value<int>(), "dorm fill room grants nothing the room already creates");
                AssertEqual(freeRoom.InitFurniture.Count(id => id > 0), ((JArray)room["unpurchasable"]!).Count,
                    "dorm fill room reports the pieces that come with the room");
            }

            // ---- a room the account has not opened refuses instead of filling it.
            long lockedUid = 90_6703;
            AscNet.Common.Database.Player lockedPlayer = DormBuilderPlayer(lockedUid, [freeRoom.Id]);
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(lockedUid), lockedPlayer,
                CreateDrawCompatibilityInventory(lockedUid, []), "dorm-builder-locked"))
            {
                string refusal = RunDormCommandExpectingRefusal(harness, "fill", paidRoom.Id.ToString());
                AssertEqual(true, refusal.Contains(paidRoom.Id.ToString()), "dorm fill locked room names the room");
                AssertEqual(true, refusal.Contains((paidRoom.ConsumeItemId ?? 0).ToString()), "dorm fill locked room names the price item");
                AssertEqual(0, lockedPlayer.Dorm.Furniture.Count, "dorm fill locked room grants nothing");
            }

            // ---- an id neither table names refuses and lists the ids it does know.
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(lockedUid), lockedPlayer,
                CreateDrawCompatibilityInventory(lockedUid, []), "dorm-builder-unknown"))
            {
                string refusal = RunDormCommandExpectingRefusal(harness, "fill", "999999");
                AssertEqual(true, refusal.Contains(dormitories.OrderBy(row => row.Id).First().Id.ToString()),
                    "dorm fill unknown room lists the dormitory ids");
                AssertEqual(true, refusal.Contains(templates.OrderBy(row => row.Id).First().Id.ToString()),
                    "dorm fill unknown room lists the template ids");
            }

            // ---- fill all: every room template's union, once.
            long allUid = 90_6704;
            AscNet.Common.Database.Player allPlayer = DormBuilderPlayer(allUid, [freeRoom.Id]);
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(allUid), allPlayer,
                CreateDrawCompatibilityInventory(allUid, []), "dorm-builder-all"))
            {
                JObject all = RunDormCommand(harness, "fill", "all");
                AssertEqual("all", all["scope"]!.Value<string>(), "dorm fill all scope");
                AssertEqual(everyGrantable.Count, all["grantedCount"]!.Value<int>(), "dorm fill all grants every grantable template");
                AssertEqual(everyGrantable.Count, allPlayer.Dorm.Furniture.Count, "dorm fill all stores every piece once");
                AssertEqual(true, allPlayer.Dorm.Furniture.All(entry => furnitureConfigs.Contains((int)entry.ConfigId)),
                    "dorm fill all grants only furniture table ids");
                AssertEqual(true, allPlayer.Dorm.Furniture.Count <= furnitureCap, "dorm fill all stays under the table cap");

                JObject repeat = RunDormCommand(harness, "fill", "all");
                AssertEqual(0, repeat["grantedCount"]!.Value<int>(), "dorm fill all second run grants nothing");

                JObject info = RunDormCommand(harness, "info");
                AssertEqual(0, info["missing"]!["grantable"]!.Value<int>(), "dorm info finds nothing grantable after a full fill");
                AssertEqual(furnitureRows.Count - everyGrantable.Count, info["missing"]!["total"]!.Value<int>(),
                    "dorm info still reports the templates no reward names");
                AssertEqual(everyGrantable.Count, ((JArray)info["owned"]!).Count, "dorm info reports the filled templates");
                AssertEqual(0, ((JArray)info["templates"]!).Children()
                    .Count(entry => entry["grantable"]!.Value<int>() > 0), "dorm info room templates are complete");
            }

            // ---- a dorm already at the table cap refuses the whole order.
            long capUid = 90_6705;
            AscNet.Common.Database.Player capPlayer = DormBuilderPlayer(capUid, [freeRoom.Id]);
            capPlayer.Dorm.Furniture = Enumerable.Range(0, furnitureCap)
                .Select(index => new PlayerDormFurniture { Id = index + 1, ConfigId = 0, DormitoryId = -1 })
                .ToList();
            using (LoopbackSessionHarness harness = new(CreateDrawCompatibilityCharacter(capUid), capPlayer,
                CreateDrawCompatibilityInventory(capUid, []), "dorm-builder-cap"))
            {
                string refusal = RunDormCommandExpectingRefusal(harness, "fill", "all");
                AssertEqual(true, refusal.Contains("cap"), "dorm fill over the cap names the cap");
                AssertEqual(furnitureCap, capPlayer.Dorm.Furniture.Count, "dorm fill over the cap grants nothing");
            }

            Console.WriteLine(
                $"dorm builder: {templates.Count} room templates, {template.Name} fill grants {templatePieces.Count} pieces, " +
                $"fill all grants {everyGrantable.Count}, {rewardByConfig.Count} of {furnitureRows.Count} table templates are grantable; " +
                "all through the game's own furniture rewards");
        }

        private static List<int> TemplatePieces(DormTemplateTable template) =>
            template.FurnitureId.Where(id => id > 0).Distinct().ToList();

        private static int DormFurnitureCap()
        {
            ConfigTable row = TableReaderV2.Parse<ConfigTable>().Single(entry => entry.Key == "DormMaxTotalFurnitureCount");
            return int.Parse(row.Value, System.Globalization.CultureInfo.InvariantCulture);
        }

        private static AscNet.Common.Database.Player DormBuilderPlayer(long uid, params int[] rooms)
        {
            AscNet.Common.Database.Player player = CreateDrawCompatibilityPlayer(uid);
            player.Dorm.Rooms = rooms
                .Select(id => new PlayerDormRoom { Id = (uint)id, Name = $"room {id}" })
                .ToList();
            return player;
        }

        private static JObject RunDormCommand(LoopbackSessionHarness harness, params string[] args)
        {
            AscNet.GameServer.Commands.Command command =
                AscNet.GameServer.Commands.CommandFactory.CreateCommand("dorm", harness.Session, args)
                ?? throw new InvalidDataException($"dorm builder: expected the dorm command for [{string.Join(", ", args)}].");
            command.Execute();
            return command.Payload is null
                ? throw new InvalidDataException($"dorm builder: {args[0]} returned no payload.")
                : JObject.FromObject(command.Payload);
        }

        private static string RunDormCommandExpectingRefusal(LoopbackSessionHarness harness, params string[] args)
        {
            try
            {
                RunDormCommand(harness, args);
            }
            catch (InvalidOperationException exception)
            {
                return exception.Message;
            }

            throw new InvalidDataException($"dorm builder: [{string.Join(", ", args)}] was expected to be refused.");
        }
    }
}