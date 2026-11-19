using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.item;

namespace AscNet.Common.Database;

public partial class Inventory
{
    // The client displays item 2 + item 3 as one Black Card balance.
    // Keep legacy constant names for compatibility with existing reward tables.
    public static bool IsBlackCard(int id) => id is PaidGem or FreeGem;

    /// <summary>
    /// Administrative assignment: the balance becomes the value, clamped to the item's table
    /// cap. Unlike Do it is not a delta, so setting a balance never depends on what it held.
    /// </summary>
    public Item SetExact(int id, long count)
    {
        if (!IsValidClientItemId(id))
            throw new InvalidDataException($"Cannot mutate unknown client item id {id}.");

        ItemTable? table = TableReaderV2.Parse<ItemTable>().Find(x => x.Id == id);
        long value = Math.Clamp(count, 0, GetMaxCount(table));

        Item? item = Items.FirstOrDefault(x => x.Id == id);
        if (item is null)
        {
            item = new Item
            {
                Id = id,
                Count = value,
                RefreshTime = DateTimeOffset.Now.ToUnixTimeSeconds(),
                CreateTime = DateTimeOffset.Now.ToUnixTimeSeconds(),
            };
            Items.Add(item);
        }
        else
        {
            item.Count = value;
            item.RefreshTime = DateTimeOffset.Now.ToUnixTimeSeconds();
        }
        return item;
    }

    /// <summary>
    /// Sets the combined Black Card balance the client shows: the whole value goes to the /bc
    /// stack (3) and the other stack (2) is emptied, so the displayed total is exactly the value.
    /// </summary>
    public List<Item> SetBlackCard(long total)
    {
        return new()
        {
            SetExact(FreeGem, total),
            SetExact(PaidGem, 0),
        };
    }

    public IEnumerable<Item> SpendableStacks(int id) => Items
        .Where(item => IsBlackCard(id) ? IsBlackCard(item.Id) : item.Id == id);

    public long SpendableCount(int id) => SpendableStacks(id).Sum(item => item.Count);

    public List<Item> Spend(int id, int amount)
    {
        if (amount < 0 || SpendableCount(id) < amount)
            throw new InvalidOperationException("Insufficient currency");
        List<Item> changed = new();
        foreach (int source in IsBlackCard(id) ? new[] { PaidGem, FreeGem } : new[] { id })
        {
            foreach (Item stack in Items.Where(item => item.Id == source))
            {
                long debit = Math.Min(amount, stack.Count);
                if (debit <= 0) continue;
                stack.Count -= debit;
                stack.RefreshTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                amount -= checked((int)debit);
                RecordSpent(source, debit);
                changed.Add(stack);
            }
        }
        return changed;
    }
}
