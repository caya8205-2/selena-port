using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.attrib;
using MongoDB.Driver;
using AscNet.Table.V2.share.equip;
using Newtonsoft.Json.Linq;
using DbCharacter = AscNet.Common.Database.Character;

namespace AscNet.Test
{
    internal partial class Program
    {
        /// <summary>
        /// The equip builder's command surface. Every one of these commands runs the game's own
        /// request handler through <c>RequestBridge</c>, so the point of the test is that the
        /// request the command builds is the request the handler expects, that the handler's own
        /// code comes back, and that the state it stores is the state the game would store.
        /// </summary>
        private static void ValidateEquipBuilderCompatibility()
        {
            // Both registries are filled at server start, not by the test host.
            AscNet.GameServer.Commands.CommandFactory.LoadCommands();
            AscNet.GameServer.PacketFactory.LoadPacketHandlers();

            List<EquipTable> equips = TableReaderV2.Parse<EquipTable>();
            List<EquipAwakeTable> awakeRecipes = TableReaderV2.Parse<EquipAwakeTable>();
            List<EquipResonanceTable> resonanceRows = TableReaderV2.Parse<EquipResonanceTable>();
            List<EquipResonanceUseItemTable> resonanceUseItems = TableReaderV2.Parse<EquipResonanceUseItemTable>();
            List<AttribPoolTable> attribPools = TableReaderV2.Parse<AttribPoolTable>();

            // ---- awaken: a memory the awake table knows, at its last breakthrough, holding a
            // resonance on slot 1, with the recipe items in the bag.
            EquipAwakeTable recipe = awakeRecipes.FirstOrDefault(row => row.ItemId.Count > 0 && row.ItemId[0] > 0 && row.ItemCount[0] > 0)
                ?? throw new InvalidDataException("equip builder: no awake recipe with item costs.");
            EquipTable awakeMemory = equips.FirstOrDefault(row => row.Id == recipe.Id && row.Site > 0)
                ?? throw new InvalidDataException($"equip builder: awake recipe {recipe.Id} has no memory row.");
            int lastBreak = LastBreakthrough(awakeMemory.Id);

            long awakeUid = 90_6501;
            EquipData awakeEquip = new()
            {
                Id = 90_6501,
                TemplateId = (uint)awakeMemory.Id,
                Level = Character.ResolveEquipBreakThrough((uint)awakeMemory.Id, lastBreak)!.LevelLimit,
                Breakthrough = lastBreak,
                ResonanceInfo =
                [
                    new ResonanceInfo { Slot = 1, Type = EquipResonanceType.Attrib, CharacterId = 1011002, TemplateId = attribPools.FirstOrDefault()?.Id ?? 1 }
                ],
            };
            Inventory awakeInventory = MaterialInventory(awakeUid,
                recipe.ItemId.Zip(recipe.ItemCount).Select(pair => (pair.First, pair.Second * 4)).ToArray());

            // the same memory without the recipe items, to prove the handler's own refusal reaches
            // the command instead of a guessed success
            long poorUid = 90_6502;
            EquipData poorEquip = new()
            {
                Id = 90_6502,
                TemplateId = (uint)awakeMemory.Id,
                Level = Character.ResolveEquipBreakThrough((uint)awakeMemory.Id, lastBreak)!.LevelLimit,
                Breakthrough = lastBreak,
                ResonanceInfo =
                [
                    new ResonanceInfo { Slot = 1, Type = EquipResonanceType.Attrib, CharacterId = 1011002, TemplateId = attribPools.FirstOrDefault()?.Id ?? 1 }
                ],
            };
            Inventory poorInventory = MaterialInventory(poorUid);

            // ---- resonance: a memory whose slot-1 pool and select item both exist.
            EquipResonanceTable pool = resonanceRows.FirstOrDefault(row =>
                row.AttribPoolId.Count > 0 && row.AttribPoolId[0] > 0
                && resonanceUseItems.Any(use => use.Id == row.Id && use.SelectSkillItemId > 0)
                && equips.Any(equip => equip.Id == row.Id && equip.Site > 0))
                ?? throw new InvalidDataException("equip builder: no memory with a slot-1 pool and a select item.");
            EquipTable resonanceMemory = equips.First(equip => equip.Id == pool.Id && equip.Site > 0);
            AttribPoolTable attrib = attribPools.FirstOrDefault(row => row.PoolId == pool.AttribPoolId[0])
                ?? throw new InvalidDataException($"equip builder: attrib pool {pool.AttribPoolId[0]} has no rows.");
            int selectItemId = resonanceUseItems.First(use => use.Id == pool.Id).SelectSkillItemId ?? 0;
            if (selectItemId <= 0)
                throw new InvalidDataException("equip builder: the resonance select item is empty.");

            long resonanceUid = 90_6503;
            const int resonanceCharacter = 1261003;
            EquipData resonanceEquip = new()
            {
                Id = 90_6503,
                TemplateId = (uint)resonanceMemory.Id,
                Level = 1,
                Breakthrough = 0,
            };
            Inventory resonanceInventory = MaterialInventory(resonanceUid, (selectItemId, 99));
            List<CharacterData> resonanceCharacters = equips.Count > 0 ? [new CharacterData { Id = resonanceCharacter }] : [];

            // ---- overrun: a weapon with a level-1 overrun row.
            WeaponOverrunTable overrunRow = TableReaderV2.Parse<WeaponOverrunTable>()
                .FirstOrDefault(row => row.Level == 1 && row.ConsumeItemIds > 0 && row.ConsumeItemCounts > 0)
                ?? throw new InvalidDataException("equip builder: no weapon overrun row with consume items.");
            long overrunUid = 90_6504;
            EquipData overrunEquip = new()
            {
                Id = 90_6504,
                TemplateId = (uint)overrunRow.WeaponId,
                Level = 45,
                WeaponOverrunData = new(),
            };
            Inventory overrunInventory = MaterialInventory(overrunUid, (overrunRow.ConsumeItemIds, overrunRow.ConsumeItemCounts * 2));

            // ---- feed and breakthrough: a memory at level 1, breakthrough 0.
            EquipBreakThroughTable firstRow = TableReaderV2.Parse<EquipBreakThroughTable>()
                .FirstOrDefault(row => row.UseMoney > 0 && row.ItemId.Count > 0 && row.ItemId[0] > 0)
                ?? throw new InvalidDataException("equip builder: no breakthrough row with material costs.");
            int expItemId = TableReaderV2.Parse<AscNet.Table.V2.share.item.ItemTable>()
                .FirstOrDefault(item => item.GetEquipUpgradeInfo().Exp > 0)?.Id ?? 0;
            if (expItemId == 0)
                throw new InvalidDataException("equip builder: no item carries equip feed exp.");

            long feedUid = 90_6505;
            EquipData feedEquip = new() { Id = 90_6505, TemplateId = (uint)firstRow.EquipId, Level = 1, Breakthrough = 0 };
            int firstLevelLimit = Character.ResolveEquipBreakThrough((uint)firstRow.EquipId, 0)!.LevelLimit;
            List<(int, int)> feedMaterials = [(expItemId, 999), (Inventory.Coin, 999_999)];
            Inventory feedInventory = MaterialInventory(feedUid, feedMaterials.ToArray());

            long breakUid = 90_6506;
            EquipData breakEquip = new() { Id = 90_6506, TemplateId = (uint)firstRow.EquipId, Level = firstLevelLimit, Breakthrough = 0 };
            List<(int, int)> breakMaterials = firstRow.ItemId.Zip(firstRow.ItemCount).Select(pair => (pair.First, pair.Second * 2)).ToList();
            breakMaterials.Add((firstRow.UseItemId == 0 ? Inventory.Coin : firstRow.UseItemId, firstRow.UseMoney * 2));
            Inventory breakInventory = MaterialInventory(breakUid, breakMaterials.ToArray());

            Dictionary<long, (DbCharacter Character, Inventory Inventory, List<CharacterData> Characters, Player Player)> fixtures = new()
            {
                [awakeUid] = (EquipBuilderFixture(awakeUid, awakeEquip, []), awakeInventory, [], CreateDrawCompatibilityPlayer(awakeUid)),
                [poorUid] = (EquipBuilderFixture(poorUid, poorEquip, []), poorInventory, [], CreateDrawCompatibilityPlayer(poorUid)),
                [resonanceUid] = (EquipBuilderFixture(resonanceUid, resonanceEquip, resonanceCharacters), resonanceInventory, resonanceCharacters, CreateDrawCompatibilityPlayer(resonanceUid)),
                [overrunUid] = (EquipBuilderFixture(overrunUid, overrunEquip, []), overrunInventory, [], CreateDrawCompatibilityPlayer(overrunUid)),
                [feedUid] = (EquipBuilderFixture(feedUid, feedEquip, []), feedInventory, [], CreateDrawCompatibilityPlayer(feedUid)),
                [breakUid] = (EquipBuilderFixture(breakUid, breakEquip, []), breakInventory, [], CreateDrawCompatibilityPlayer(breakUid)),
            };

            try
            {
                foreach ((DbCharacter character, Inventory inventory, List<CharacterData> _, Player player) in fixtures.Values)
                {
                    DbCharacter.collection.InsertOne(character);
                    Inventory.collection.InsertOne(inventory);
                    // the handlers record task progress, which saves the player document
                    Player.collection.InsertOne(player);
                }

                // 1. Awaken: the recipe is spent and the slot is recorded.
                int recipeCount = awakeEquip.AwakeSlotList.Count;
                JObject awake = RunEquipCommand(fixtures[awakeUid], "awake", "906501", "1", "1");
                AssertEqual(true, awake["ok"]!.Value<bool>(), "equip awake accepted");
                AssertEqual(0, awake["code"]!.Value<int>(), "equip awake code");
                AssertEqual(recipeCount + 1, awakeEquip.AwakeSlotList.Count, "equip awake slot count");
                AssertEqual(1, Convert.ToInt32(awakeEquip.AwakeSlotList[^1]), "equip awake slot id");

                // 2. Awaken without the recipe items: the handler's insufficient-items code comes back
                // and nothing is added.
                JObject poor = RunEquipCommand(fixtures[poorUid], "awake", "906502", "1", "1");
                AssertEqual(false, poor["ok"]!.Value<bool>(), "equip awake without materials refused");
                AssertEqual(0, poorEquip.AwakeSlotList.Count, "equip awake without materials keeps no slot");

                // 3. One selected resonance lands in the requested slot with the requested id.
                JObject resonate = RunEquipCommand(fixtures[resonanceUid], "resonate", "906503", "1", "attrib", attrib.Id.ToString(), resonanceCharacter.ToString());
                AssertEqual(true, resonate["ok"]!.Value<bool>(), "equip resonate accepted");
                ResonanceInfo stored = resonanceEquip.ResonanceInfo.FirstOrDefault(info => info.Slot == 1)
                    ?? throw new InvalidDataException("equip resonate: expected a slot-1 resonance.");
                AssertEqual(attrib.Id, stored.TemplateId, "equip resonate template");
                AssertEqual((int)EquipResonanceType.Attrib, (int)stored.Type, "equip resonate type");
                AssertEqual(resonanceCharacter, stored.CharacterId, "equip resonate character");

                // 4. Overrun: level 1, and the consume items were spent.
                long overrunItemsBefore = overrunInventory.Items.First(item => item.Id == overrunRow.ConsumeItemIds).Count;
                JObject overrun = RunEquipCommand(fixtures[overrunUid], "overrun", "906504", "1");
                AssertEqual(true, overrun["ok"]!.Value<bool>(), "equip overrun accepted");
                AssertEqual(1, overrunEquip.WeaponOverrunData.Level, "equip overrun level");
                long overrunItemsAfter = overrunInventory.Items.First(item => item.Id == overrunRow.ConsumeItemIds).Count;
                AssertEqual(true, overrunItemsAfter < overrunItemsBefore, "equip overrun spent its items");

                // 5. Feed: the level moves and the coins are gone.
                long coinsBefore = feedInventory.Items.First(item => item.Id == Inventory.Coin).Count;
                JObject feed = RunEquipCommand(fixtures[feedUid], "feed", "906505");
                AssertEqual(true, feed["ok"]!.Value<bool>(), "equip feed accepted");
                AssertEqual(true, feedEquip.Level > 1, "equip feed raised the level");
                AssertEqual(true, feedInventory.Items.First(item => item.Id == Inventory.Coin).Count < coinsBefore, "equip feed spent coins");

                // 6. Breakthrough: one step, and the level resets the way the game resets it.
                JObject broke = RunEquipCommand(fixtures[breakUid], "break", "906506");
                AssertEqual(true, broke["ok"]!.Value<bool>(), "equip break accepted");
                AssertEqual(1, breakEquip.Breakthrough, "equip break breakthrough");
                AssertEqual(1, breakEquip.Level, "equip break level reset");

                Console.WriteLine(
                    $"equip builder: awake {awakeMemory.Name}, resonance {resonanceMemory.Name} -> {attrib.Name}, overrun {overrunRow.WeaponId} level 1, feed level {feedEquip.Level}, break {breakEquip.Breakthrough}; all through the game's own handlers");
            }
            finally
            {
                foreach ((DbCharacter character, Inventory inventory, List<CharacterData> _, Player player) in fixtures.Values)
                {
                    DbCharacter.collection.DeleteMany(candidate => candidate.Uid == character.Uid);
                    Inventory.collection.DeleteMany(candidate => candidate.Uid == inventory.Uid);
                    Player.collection.DeleteMany(candidate => candidate.PlayerData.Id == player.PlayerData.Id);
                }
            }
        }

        private static int LastBreakthrough(int templateId)
        {
            int last = 0;
            while (Character.ResolveEquipBreakThrough((uint)templateId, last + 1) is not null)
                last += 1;
            return last;
        }

        private static JObject RunEquipCommand(
            (DbCharacter Character, Inventory Inventory, List<CharacterData> Characters, Player Player) fixture,
            params string[] args)
        {
            using LoopbackSessionHarness harness = new(
                fixture.Character,
                fixture.Player,
                fixture.Inventory,
                sessionId: $"equip-builder-{fixture.Character.Uid}-{args[0]}");
            AscNet.GameServer.Commands.Command command =
                AscNet.GameServer.Commands.CommandFactory.CreateCommand("equip", harness.Session, args)
                ?? throw new InvalidDataException($"equip builder: expected the equip command for [{string.Join(", ", args)}].");
            command.Execute();
            return command.Payload is null
                ? throw new InvalidDataException($"equip builder: {args[0]} returned no payload.")
                : JObject.FromObject(command.Payload);
        }

        private static DbCharacter EquipBuilderFixture(long uid, EquipData equip, List<CharacterData> characters)
        {
            return new DbCharacter
            {
                Uid = uid,
                Characters = characters,
                Equips = [equip],
                Fashions = []
            };
        }

        private static Inventory MaterialInventory(long uid, params (int Id, int Count)[] materials)
        {
            return new Inventory
            {
                Uid = uid,
                Items = materials.Select(material => new Item
                {
                    Id = material.Id,
                    Count = Math.Max(1, material.Count),
                    CreateTime = 1,
                    RefreshTime = 1,
                }).ToList()
            };
        }
    }
}