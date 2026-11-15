using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.config;
using AscNet.Table.V2.share.dormitory;
using AscNet.Table.V2.share.dormitory.furniture;

namespace AscNet.GameServer.Commands
{
    /// <summary>
    /// The dorm panel's read model and its one grant path.
    /// <para>
    /// Furniture ownership is account wide: an owned piece sits in the warehouse until the client
    /// places it in a room, and the client's owned set is the furniture unlock list plus the config
    /// ids of the instances (<c>DormModule.BuildLoginData</c> sends exactly that union). A fill
    /// therefore grants furniture rewards, the same reward type the game's own furniture grants
    /// use, and leaves placement, layouts and unlocks derived from the instances to the client.
    /// </para>
    /// <para>
    /// The tables name furniture in two places: a room template (<c>DormTemplate.tsv</c>, the
    /// themed room presets such as "Cafe") lists the pieces of that room, and a dormitory
    /// (<c>Dormitory.tsv</c>) lists the basic structure pieces it creates when it is opened. Every
    /// piece that can be granted has a <c>FurnitureReward.tsv</c> row; the structure pieces do not,
    /// they come with the room, so a room fill reports them instead of inventing a grant.
    /// </para>
    /// </summary>
    [CommandName("dorm")]
    internal class DormCommand : Command
    {
        private object? payload;

        public DormCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help =>
            "Dorm: info [room|all], fill <room|all>. A room is a DormTemplate.tsv room template (20, 201-233) " +
            "or a Dormitory.tsv room id (21001-21030); fill grants the furniture the tables name and the account " +
            "does not own yet, and leaves placement to the game.";

        public override object? Payload => payload;

        [Argument(0, @"^info$|^fill$", "The operation selected (info, fill)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$|^all$", "A room template id, a dormitory id, or 'all'", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Target { get; set; } = string.Empty;

        public override void Execute()
        {
            switch (Op.ToLowerInvariant())
            {
                case "info":
                    payload = Describe();
                    return;
                case "fill":
                    payload = Fill();
                    return;
                default:
                    throw new InvalidOperationException("Invalid operation!");
            }
        }

        private object Describe()
        {
            List<FurnitureTable> furniture = TableReaderV2.Parse<FurnitureTable>();
            Dictionary<int, int> rewardByConfig = RewardIdByFurnitureConfig();
            HashSet<uint> owned = OwnedConfigIds();
            List<PlayerDormFurniture> instances = session.player.Dorm.Furniture;

            List<object> rooms = session.player.Dorm.Rooms
                .OrderBy(room => room.Id)
                .Select(room => (object)new
                {
                    roomId = (int)room.Id,
                    room.Name,
                    placed = instances.Count(entry => entry.DormitoryId == (int)room.Id),
                })
                .ToList();

            List<object> ownedFurniture = furniture
                .Where(row => owned.Contains((uint)row.Id))
                .OrderBy(row => row.Id)
                .Select(row => (object)new
                {
                    configId = row.Id,
                    row.Name,
                    count = instances.Count(entry => entry.ConfigId == (uint)row.Id),
                    unlocked = session.player.Dorm.FurnitureUnlocks.Contains((uint)row.Id),
                })
                .ToList();

            List<object> placed = instances
                .Where(entry => entry.DormitoryId > 0)
                .OrderBy(entry => entry.DormitoryId)
                .ThenBy(entry => entry.Id)
                .Select(entry => (object)new
                {
                    furnitureId = entry.Id,
                    configId = (int)entry.ConfigId,
                    roomId = entry.DormitoryId,
                    entry.X,
                    entry.Y,
                    entry.Angle,
                })
                .ToList();

            List<object> layouts = session.player.Dorm.Layouts
                .OrderBy(layout => layout.LayoutId)
                .Select(layout => (object)new
                {
                    layoutId = layout.LayoutId,
                    layout.Name,
                    pieces = layout.FurnitureList.Count,
                    boundRooms = session.player.Dorm.BindRelations
                        .Where(bind => bind.LayoutId == layout.LayoutId)
                        .Select(bind => bind.DormitoryId)
                        .ToList(),
                })
                .ToList();

            List<int> missing = furniture
                .Where(row => !owned.Contains((uint)row.Id))
                .Select(row => row.Id)
                .Order()
                .ToList();

            List<object> templates = TableReaderV2.Parse<DormTemplateTable>()
                .OrderBy(row => row.Id)
                .Select(row => (object)new
                {
                    templateId = row.Id,
                    row.Name,
                    pieces = TemplateConfigIds(row).Count,
                    missing = TemplateConfigIds(row).Count(id => !owned.Contains((uint)id)),
                    grantable = TemplateConfigIds(row).Count(id => !owned.Contains((uint)id) && rewardByConfig.ContainsKey(id)),
                })
                .ToList();

            return new
            {
                ok = true,
                rooms,
                owned = ownedFurniture,
                placed,
                layouts,
                warehouse = instances.Count(entry => entry.DormitoryId <= 0),
                missing = new
                {
                    total = missing.Count,
                    grantable = missing.Count(id => rewardByConfig.ContainsKey(id)),
                    unpurchasable = missing.Count(id => !rewardByConfig.ContainsKey(id)),
                    ids = missing,
                },
                templates,
            };
        }

        private object Fill()
        {
            (string scope, int target, List<int> configIds) = ResolveFillTarget();
            Dictionary<int, int> rewardByConfig = RewardIdByFurnitureConfig();
            List<FurnitureTable> furniture = TableReaderV2.Parse<FurnitureTable>();
            Dictionary<int, FurnitureTable> rowsById = furniture.ToDictionary(row => row.Id);
            HashSet<uint> owned = OwnedConfigIds();

            List<int> unknown = configIds.Where(id => !rowsById.ContainsKey(id)).Order().ToList();
            List<int> known = configIds.Where(rowsById.ContainsKey).Order().ToList();
            List<int> alreadyOwned = known.Where(id => owned.Contains((uint)id)).ToList();
            List<int> missing = known.Where(id => !owned.Contains((uint)id)).ToList();
            List<int> grantable = missing.Where(rewardByConfig.ContainsKey).ToList();
            List<int> unpurchasable = missing.Where(id => !rewardByConfig.ContainsKey(id)).ToList();

            if (grantable.Count == 0)
            {
                payload = new
                {
                    ok = true,
                    scope,
                    target,
                    pieces = known.Count,
                    granted = Array.Empty<object>(),
                    grantedCount = 0,
                    alreadyOwned,
                    unpurchasable = unpurchasable.Select(id => rowsById[id].Name).ToList(),
                    unknown,
                    note = unpurchasable.Count > 0
                        ? "every piece the tables name is owned or comes with the room itself; nothing is grantable."
                        : "every piece the tables name is already owned; nothing to grant.",
                };
                return payload;
            }

            int cap = DormMaxTotalFurnitureCount();
            int held = session.player.Dorm.Furniture.Count;
            if ((long)held + grantable.Count > cap)
                throw new InvalidOperationException(
                    $"this fill would add {grantable.Count} furniture pieces to the {held} this dorm holds, over the " +
                    $"table cap of {cap}; nothing was granted.");

            // One batch so caps, receipts and pushes behave exactly like every other grant path.
            RewardApplicationResult result = RewardHandler.ApplyRewards(
                grantable.Select(id => new Reward { Id = rewardByConfig[id], Type = RewardType.Furniture }).ToList(),
                session);

            session.inventory.SaveChecked();
            session.character.SaveChecked();
            if (result.DormFurnitureChanged)
                session.player.SaveChecked();
            result.SendPushes(session);

            payload = new
            {
                ok = true,
                scope,
                target,
                pieces = known.Count,
                granted = grantable.Select(id => new { configId = id, rowsById[id].Name, rewardId = rewardByConfig[id] }).ToList(),
                grantedCount = grantable.Count,
                alreadyOwned,
                unpurchasable = unpurchasable.Select(id => rowsById[id].Name).ToList(),
                unknown,
                held,
                cap,
            };
            return payload;
        }

        /// <summary>
        /// What a fill covers. A template names the pieces of one themed room; a dormitory names the
        /// structure it creates, which is refused until the room is unlocked so a grant never looks
        /// like it furnished a room the account cannot open; "all" is every furniture the furniture
        /// table defines, so a completed fill leaves nothing below usable.
        /// </summary>
        private (string Scope, int Target, List<int> ConfigIds) ResolveFillTarget()
        {
            List<DormTemplateTable> templates = TableReaderV2.Parse<DormTemplateTable>();
            if (Target.Equals("all", StringComparison.OrdinalIgnoreCase))
                return ("all", 0, TableReaderV2.Parse<FurnitureTable>().Select(row => row.Id).Order().ToList());

            int id = Miscs.ParseIntOr(Target);
            if (id <= 0)
                throw new InvalidOperationException("a room template id, a dormitory id, or 'all' is required.");

            DormTemplateTable? template = templates.FirstOrDefault(row => row.Id == id);
            if (template is not null)
                return ("template", id, TemplateConfigIds(template));

            DormitoryTable? room = TableReaderV2.Parse<DormitoryTable>().FirstOrDefault(row => row.Id == id);
            if (room is null)
                throw new InvalidOperationException(
                    $"no dorm table names room {id}. Room templates: {string.Join(", ", templates.Select(row => row.Id).Order())}. " +
                    $"Dormitories: {string.Join(", ", TableReaderV2.Parse<DormitoryTable>().Select(row => row.Id).Order())}.");

            if (!session.player.Dorm.Rooms.Any(saved => saved.Id == (uint)id))
            {
                int itemId = room.ConsumeItemId ?? 0;
                int count = room.ConsumeItemCount ?? 0;
                throw new InvalidOperationException(itemId > 0 && count > 0
                    ? $"room {id} is not unlocked on this account; the table prices it at {count} x item {itemId}, " +
                      "and the game's own room activation spends that, so nothing was granted."
                    : $"room {id} is not unlocked on this account; open it in the game first, so nothing was granted.");
            }

            return ("room", id, room.InitFurniture.Where(configId => configId > 0).Distinct().ToList());
        }

        /// <summary>Furniture config ids a room template lists, without the empty trailing cells.</summary>
        private static List<int> TemplateConfigIds(DormTemplateTable template) =>
            template.FurnitureId.Where(id => id > 0).Distinct().ToList();

        /// <summary>
        /// The owned set the client is sent at login: the unlock list plus the config ids of owned
        /// instances. Reading one without the other calls a consumed piece missing.
        /// </summary>
        private HashSet<uint> OwnedConfigIds()
        {
            HashSet<uint> owned = session.player.Dorm.FurnitureUnlocks.ToHashSet();
            foreach (PlayerDormFurniture entry in session.player.Dorm.Furniture)
                owned.Add(entry.ConfigId);
            return owned;
        }

        /// <summary>
        /// A furniture grant spends a <c>FurnitureReward.tsv</c> row, keyed by the furniture config it
        /// produces. Rows without a config row cannot be granted, so they are never offered.
        /// </summary>
        private static Dictionary<int, int> RewardIdByFurnitureConfig()
        {
            HashSet<int> configs = TableReaderV2.Parse<FurnitureTable>().Select(row => row.Id).ToHashSet();
            Dictionary<int, int> rewards = new();
            foreach (FurnitureRewardTable row in TableReaderV2.Parse<FurnitureRewardTable>().OrderBy(row => row.Id))
                if (configs.Contains(row.FurnitureId) && !rewards.ContainsKey(row.FurnitureId))
                    rewards[row.FurnitureId] = row.Id;
            return rewards;
        }

        private static int DormMaxTotalFurnitureCount()
        {
            ConfigTable? row = TableReaderV2.Parse<ConfigTable>().FirstOrDefault(entry => entry.Key == "DormMaxTotalFurnitureCount");
            return row is not null && int.TryParse(row.Value, out int cap) && cap > 0 ? cap : int.MaxValue;
        }
    }
}