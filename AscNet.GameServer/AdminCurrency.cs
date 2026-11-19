using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.item;

namespace AscNet.GameServer
{
    /// <summary>
    /// The account tab's currency surface: the balances an admin can read and set for one
    /// account. Names and caps come from the item table; the only policy is the Black Card
    /// pair, which the client displays as one balance.
    /// </summary>
    public static class AdminCurrency
    {
        public sealed record Entry(int Id, string Name, long Count, long Max);

        // (item id, one combined balance across the Black Card pair?)
        private static readonly (int Id, bool Combined)[] Set =
        [
            (Inventory.PaidGem, true),
            (Inventory.Coin, false),
            (Inventory.HongKa, false),
            (Inventory.ActionPoint, false),
            (Inventory.DormCoin, false),
            (Inventory.FurnitureCoin, false),
            (Inventory.SimulationScore, false),
        ];

        public static List<Entry> Describe(Inventory inventory)
        {
            List<ItemTable> items = TableReaderV2.Parse<ItemTable>();
            List<Entry> entries = new(Set.Length);
            foreach ((int id, bool combined) in Set)
            {
                ItemTable? table = items.Find(x => x.Id == id);
                long count = combined
                    ? inventory.SpendableCount(id)
                    : inventory.Items.FirstOrDefault(x => x.Id == id)?.Count ?? 0;
                entries.Add(new Entry(id, Label(id, table), count, Inventory.GetMaxCount(table)));
            }
            return entries;
        }

        /// <summary>
        /// Applies exact balances: one value per currency, the Black Card pair under either of
        /// its two ids. Returns the changed stacks for the live push. The whole request is
        /// validated before any balance moves, because in a live session an earlier entry would
        /// otherwise persist on the session's next save even though the request was refused.
        /// </summary>
        public static List<Item> Apply(Inventory inventory, IReadOnlyDictionary<int, long> values)
        {
            foreach (int id in values.Keys)
            {
                if (id <= 0 || (!Set.Any(row => row.Id == id) && !Inventory.IsBlackCard(id)))
                    throw new InvalidOperationException($"currency {id} is not on the account surface");
            }
            if (values.Count(entry => Inventory.IsBlackCard(entry.Key)) > 1)
                throw new InvalidOperationException("send one Black Card value, not both stacks");

            List<Item> changed = new();
            foreach (KeyValuePair<int, long> entry in values)
            {
                if (Inventory.IsBlackCard(entry.Key))
                    changed.AddRange(inventory.SetBlackCard(entry.Value));
                else
                    changed.Add(inventory.SetExact(entry.Key, entry.Value));
            }
            return changed;
        }

        private static string Label(int id, ItemTable? table)
        {
            if (id == Inventory.SimulationScore) return "Simulation Score";
            return table?.Name ?? string.Empty;
        }
    }
}
