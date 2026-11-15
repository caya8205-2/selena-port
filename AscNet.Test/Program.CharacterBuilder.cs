using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.character;
using AscNet.Table.V2.share.character.quality;
using MongoDB.Driver;
using Newtonsoft.Json.Linq;
using DbCharacter = AscNet.Common.Database.Character;

namespace AscNet.Test
{
    internal partial class Program
    {
        /// <summary>
        /// The character builder's rank path: the shard ladder and the quality step must spend
        /// exactly what the tables say, refuse before a short balance is clamped to zero, and end
        /// where the same tables say a greedy walk ends. The last case runs the game's own
        /// ActivateStar handler on an identical player and compares the two results.
        /// </summary>
        private static void ValidateCharacterBuilderCompatibility()
        {
            // The command layer is discovered at server start, not by the test host.
            AscNet.GameServer.Commands.CommandFactory.LoadCommands();

            List<CharacterTable> characters = TableReaderV2.Parse<CharacterTable>();
            List<CharacterQualityFragmentTable> fragments = TableReaderV2.Parse<CharacterQualityFragmentTable>();

            CharacterTable row = characters.FirstOrDefault(candidate =>
                DbCharacter.IsOwnableCharacter((uint)candidate.Id)
                && fragments.Any(fragment => fragment.Type == candidate.Type
                    && fragment.Quality == 3
                    && fragment.StarUseCount.Count > 0
                    && fragment.StarUseCount.All(value => value > 0))
                && candidate.ItemId > 0)
                ?? throw new InvalidDataException("character builder: no ownable construct with a quality-3 shard ladder.");

            CharacterQualityFragmentTable ladder = fragments.First(fragment => fragment.Type == row.Type && fragment.Quality == 3);
            int firstStarCost = ladder.StarUseCount[0];
            long shardItem = row.ItemId;
            int promoteItem = ladder.PromoteItemId ?? AscNet.Common.Database.Inventory.Coin;

            // A full walk costs the whole ladder at every quality plus every promotion; the numbers
            // come from the tables here, so the scenario stays true if the tables are reimported.
            (int quality, int star, long walkShards, long walkCogs) = ExpectedWalk(row, fragments, 3, 0, 1_000_000, 1_000_000);
            long exactShards = 1_000_000 - walkShards;
            long exactCogs = 1_000_000 - walkCogs;

            long fullUid = 90_6401;
            DbCharacter fullCharacter = CharacterBuilderFixture(fullUid, row.Id, 3, exactShards);
            Inventory fullInventory = CharacterBuilderInventory(fullUid, row.ItemId, exactShards, promoteItem, exactCogs);

            long shortUid = 90_6402;
            DbCharacter shortCharacter = CharacterBuilderFixture(shortUid, row.Id, 3, firstStarCost * 8 + 1);
            Inventory shortInventory = CharacterBuilderInventory(shortUid, row.ItemId, firstStarCost * 8 + 1, promoteItem, 0);

            long parityCommandUid = 90_6403;
            DbCharacter parityCommandCharacter = CharacterBuilderFixture(parityCommandUid, row.Id, 3, firstStarCost);
            Inventory parityCommandInventory = CharacterBuilderInventory(parityCommandUid, row.ItemId, firstStarCost, promoteItem, 0);

            long parityHandlerUid = 90_6404;
            DbCharacter parityHandlerCharacter = CharacterBuilderFixture(parityHandlerUid, row.Id, 3, firstStarCost);
            Inventory parityHandlerInventory = CharacterBuilderInventory(parityHandlerUid, row.ItemId, firstStarCost, promoteItem, 0);

            long grantUid = 90_6405;
            DbCharacter grantCharacter = CharacterBuilderFixture(grantUid, row.Id, 3, firstStarCost);
            Inventory grantInventory = CharacterBuilderInventory(grantUid, row.ItemId, firstStarCost, promoteItem, 0);

            List<DbCharacter> charactersToInsert = [fullCharacter, shortCharacter, parityCommandCharacter, parityHandlerCharacter, grantCharacter];
            List<Inventory> inventoriesToInsert = [fullInventory, shortInventory, parityCommandInventory, parityHandlerInventory, grantInventory];
            try
            {
                foreach (DbCharacter document in charactersToInsert)
                    DbCharacter.collection.InsertOne(document);
                foreach (Inventory document in inventoriesToInsert)
                    Inventory.collection.InsertOne(document);

                // 1. Read model: progression, the next step and its cost, from the tables.
                JObject info = RunCharacterCommand(fullUid, fullCharacter, fullInventory, "info", ((int)row.Id).ToString());
                AssertEqual((int)row.Id, info["character"]!["id"]!.Value<int>(), "character info id");
                AssertEqual(3, info["character"]!["quality"]!.Value<int>(), "character info quality");
                AssertEqual(0, info["character"]!["star"]!.Value<int>(), "character info star");
                AssertEqual(exactShards, info["character"]!["shards"]!.Value<long>(), "character info shards");
                AssertEqual("star", info["next"]!["kind"]!.Value<string>(), "character info next kind");
                AssertEqual((int)shardItem, info["next"]!["itemId"]!.Value<int>(), "character info next item");
                AssertEqual(firstStarCost, info["next"]!["cost"]!.Value<int>(), "character info next cost");
                AssertEqual(true, info["next"]!["affordable"]!.Value<bool>(), "character info next affordable");

                // 2. One shard step spends the table's own count and moves the star by one.
                JObject starStep = RunCharacterCommand(fullUid, fullCharacter, fullInventory, "rank", ((int)row.Id).ToString(), "star");
                AssertEqual(1, starStep["steps"]!.Value<int>(), "character rank star steps");
                AssertEqual(1, fullCharacter.Characters[0].Star, "character rank star value");
                AssertEqual(exactShards - firstStarCost, InventoryBalance(fullInventory, (int)shardItem), "character rank star shard balance");

                // 3. A quality step is refused while the shard ladder is unspent, because the reset to
                // star 0 would throw the remaining steps away.
                JObject early = RunCharacterCommand(fullUid, fullCharacter, fullInventory, "rank", ((int)row.Id).ToString(), "quality");
                AssertEqual(0, early["steps"]!.Value<int>(), "character rank quality before ladder steps");
                AssertEqual(3, fullCharacter.Characters[0].Quality, "character rank quality unchanged");
                if (!early["stopped"]!.Value<string>().Contains("not spent", StringComparison.Ordinal))
                    throw new InvalidDataException($"character rank quality refusal: expected an unspent-ladder reason, got '{early["stopped"]}'.");

                // 4. Walking to the end spends exactly what a greedy table walk spends.
                JObject full = RunCharacterCommand(fullUid, fullCharacter, fullInventory, "rank", ((int)row.Id).ToString(), "max");
                AssertEqual(quality, fullCharacter.Characters[0].Quality, "character rank max quality");
                AssertEqual(star, fullCharacter.Characters[0].Star, "character rank max star");
                AssertEqual(0L, InventoryBalance(fullInventory, (int)shardItem), "character rank max shard balance");
                AssertEqual(0L, InventoryBalance(fullInventory, promoteItem), "character rank max promote balance");
                AssertEqual(true, full["ok"]!.Value<bool>(), "character rank max ok");

                // 5. A short balance stops before the step and names the shortfall; nothing goes negative.
                JObject shortWalk = RunCharacterCommand(shortUid, shortCharacter, shortInventory, "rank", ((int)row.Id).ToString(), "max");
                AssertEqual(8, shortCharacter.Characters[0].Star, "character rank short star");
                AssertEqual(1L, InventoryBalance(shortInventory, (int)shardItem), "character rank short shard balance");
                AssertEqual(true, shortWalk["stopped"]!.Value<string>().Contains("short by", StringComparison.Ordinal), "character rank short reason");

                // 6. Shards are a grant, not a rank change.
                JObject granted = RunCharacterCommand(grantUid, grantCharacter, grantInventory, "shards", ((int)row.Id).ToString(), "50");
                AssertEqual(50, granted["granted"]!.Value<int>(), "character shards granted");
                AssertEqual(firstStarCost + 50L, InventoryBalance(grantInventory, (int)shardItem), "character shards balance");
                AssertEqual(0, grantCharacter.Characters[0].Star, "character shards leave the star alone");
                AssertEqual(3, grantCharacter.Characters[0].Quality, "character shards leave the quality alone");

                // 7. Parity with the game's own handler on an identical player.
                using (LoopbackSessionHarness commandHarness = new(parityCommandCharacter, inventory: parityCommandInventory, sessionId: "character-builder-command"))
                {
                    AscNet.GameServer.Commands.Command command =
                        AscNet.GameServer.Commands.CommandFactory.CreateCommand("character", commandHarness.Session, ["rank", ((int)row.Id).ToString(), "star"])
                        ?? throw new InvalidDataException("character builder: expected the character command.");
                    command.Execute();
                }

                using (LoopbackSessionHarness handlerHarness = new(parityHandlerCharacter, inventory: parityHandlerInventory, sessionId: "character-builder-handler"))
                {
                    InvokeRequestHandler(
                        handlerHarness,
                        nameof(CharacterActivateStarRequest),
                        90_641,
                        new CharacterActivateStarRequest { TemplateId = (int)row.Id });
                }

                AssertEqual(parityCommandCharacter.Characters[0].Star, parityHandlerCharacter.Characters[0].Star, "character builder parity star");
                AssertEqual(parityCommandCharacter.Characters[0].Quality, parityHandlerCharacter.Characters[0].Quality, "character builder parity quality");
                AssertEqual(
                    InventoryBalance(parityCommandInventory, (int)shardItem),
                    InventoryBalance(parityHandlerInventory, (int)shardItem),
                    "character builder parity shard balance");

                Console.WriteLine($"character builder: {row.Name} walks to quality {quality} star {star} for {exactShards} shards and {exactCogs} coins; parity with CharacterActivateStarRequest holds");
            }
            finally
            {
                foreach (DbCharacter document in charactersToInsert)
                    DbCharacter.collection.DeleteMany(candidate => candidate.Uid == document.Uid);
                foreach (Inventory document in inventoriesToInsert)
                    Inventory.collection.DeleteMany(candidate => candidate.Uid == document.Uid);
            }
        }

        private static JObject RunCharacterCommand(long uid, DbCharacter character, Inventory inventory, params string[] args)
        {
            using LoopbackSessionHarness harness = new(character, inventory: inventory, sessionId: $"character-builder-{uid}-{args[0]}");
            AscNet.GameServer.Commands.Command command =
                AscNet.GameServer.Commands.CommandFactory.CreateCommand("character", harness.Session, args)
                ?? throw new InvalidDataException($"character builder: expected the character command for [{string.Join(", ", args)}].");
            command.Execute();
            return command.Payload is null
                ? throw new InvalidDataException($"character builder: {args[0]} returned no payload.")
                : JObject.FromObject(command.Payload);
        }

        private static (int Quality, int Star, long Shards, long Cogs) ExpectedWalk(
            CharacterTable row,
            List<CharacterQualityFragmentTable> fragments,
            int quality,
            int star,
            long shards,
            long cogs)
        {
            while (true)
            {
                CharacterQualityFragmentTable? ladder = fragments.FirstOrDefault(fragment => fragment.Type == row.Type && fragment.Quality == quality);
                if (ladder is null)
                    return (quality, star, shards, cogs);

                if (star < ladder.StarUseCount.Count && ladder.StarUseCount[star] > 0)
                {
                    int cost = ladder.StarUseCount[star];
                    if (shards < cost) return (quality, star, shards, cogs);
                    shards -= cost;
                    star++;
                    continue;
                }

                if (!fragments.Any(fragment => fragment.Type == row.Type && fragment.Quality == quality + 1))
                    return (quality, star, shards, cogs);

                int item = ladder.PromoteItemId ?? AscNet.Common.Database.Inventory.Coin;
                long cost2 = ladder.PromoteUseCoin ?? 0;
                long balance = item == row.ItemId ? shards : cogs;
                if (cost2 > balance) return (quality, star, shards, cogs);
                if (item == row.ItemId) shards -= cost2;
                else cogs -= cost2;
                quality++;
                star = 0;
            }
        }

        private static DbCharacter CharacterBuilderFixture(long uid, int characterId, int quality, long shards)
        {
            return new DbCharacter
            {
                Uid = uid,
                Characters =
                [
                    new CharacterData
                    {
                        Id = (uint)characterId,
                        Level = 80,
                        Quality = quality,
                        InitQuality = quality,
                        Star = 0,
                    }
                ],
                Equips = [],
                Fashions = []
            };
        }

        private static Inventory CharacterBuilderInventory(long uid, long shardItem, long shards, int promoteItem, long cogs)
        {
            List<Item> items = [new Item { Id = (int)shardItem, Count = shards, CreateTime = 1, RefreshTime = 1 }];
            if (cogs > 0 && promoteItem != shardItem)
                items.Add(new Item { Id = promoteItem, Count = cogs, CreateTime = 1, RefreshTime = 1 });
            return new Inventory { Uid = uid, Items = items };
        }

        private static long InventoryBalance(Inventory inventory, int itemId) =>
            inventory.Items.FirstOrDefault(item => item.Id == itemId)?.Count ?? 0;
    }
}