using System.Security.Cryptography;
using System.Text;
using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.equip;

namespace AscNet.GameServer.Commands
{
    /// <summary>
    /// Bulk removal of spare equipment, in two steps: a preview that reports what
    /// would go and returns a token derived from that exact set, then an apply that
    /// only runs when the caller echoes the token.
    /// <para>
    /// Weapons and memories only. Items are excluded on purpose: an inventory entry
    /// carries no "in use" signal, so a bulk delete there could reach currency or a
    /// quest ticket. Partners are excluded because their star rating lives on the
    /// instance rather than a template column, so "up to N stars" has no honest
    /// meaning for them yet.
    /// </para>
    /// </summary>
    [CommandName("cleanup")]
    internal class CleanupCommand : Command
    {
        private object? payload;

        public CleanupCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Inventory cleanup: preview counts what would be removed, apply removes it using the token from that preview.";

        public override object? Payload => payload;

        [Argument(0, @"^preview$|^apply$", "Operation (preview, apply)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^weapons$|^memories$", "Equipment category (weapons, memories)", ArgumentFlags.IgnoreCase)]
        string Category { get; set; } = string.Empty;

        [Argument(2, @"^[1-6]$", "Highest star rating to remove (1-6)")]
        string Star { get; set; } = string.Empty;

        [Argument(3, @"^0$|^1$", "Include levelled and promoted entries (0, 1)", ArgumentFlags.Optional)]
        string IncludeDeveloped { get; set; } = "0";

        [Argument(4, @"^confirm=[A-Za-z0-9-]+$", "Token returned by the preview", ArgumentFlags.Optional)]
        string Confirm { get; set; } = string.Empty;

        public override void Execute()
        {
            int star = int.Parse(Star);
            bool includeDeveloped = IncludeDeveloped == "1";
            bool weapons = Category.Equals("weapons", StringComparison.OrdinalIgnoreCase);

            if (Op.Equals("preview", StringComparison.OrdinalIgnoreCase))
            {
                List<EquipData> candidates = CollectCandidates(weapons, star, includeDeveloped);
                payload = new
                {
                    ok = true,
                    category = weapons ? "weapons" : "memories",
                    star,
                    eligible = candidates.Count,
                    units = candidates.Count,
                    token = Token(candidates, weapons, star, includeDeveloped),
                    sample = Sample(candidates),
                };
                return;
            }

            // Apply: the set is recomputed under the player's operation lock, then
            // compared with the preview token. If anything changed in between (a
            // new grant, an equip, a lock) the token no longer matches and nothing
            // is deleted.
            lock (Session.GetPlayerOperationLock(session.player.PlayerData.Id))
            {
                List<EquipData> candidates = CollectCandidates(weapons, star, includeDeveloped);
                string expected = Token(candidates, weapons, star, includeDeveloped);

                if (!Confirm.EndsWith(expected, StringComparison.Ordinal))
                    throw new InvalidOperationException(
                        $"Confirmation token mismatch ({candidates.Count} entries currently eligible). Preview again.");

                if (candidates.Count == 0)
                    throw new InvalidOperationException("Nothing is eligible for cleanup with those settings.");

                NotifyEquipDataList notify = new();
                foreach (EquipData equip in candidates)
                {
                    session.character.Equips.Remove(equip);
                    notify.DeletedEquipIdList.Add(equip.Id);
                }

                // SaveChecked throws when the update does not match exactly one
                // document, so a failed write is not reported as success.
                session.character.SaveChecked();
                session.SendPush(notify);

                payload = new
                {
                    ok = true,
                    removed = candidates.Count,
                    items = notify.DeletedEquipIdList.Count,
                };
            }
        }

        /// <summary>
        /// Entries that may be deleted: a spare copy nobody uses, with a template in
        /// the requested category at or below the requested star.
        /// </summary>
        private List<EquipData> CollectCandidates(bool weapons, int star, bool includeDeveloped)
        {
            Dictionary<uint, EquipTable> templates = new();
            foreach (EquipTable row in TableReaderV2.Parse<EquipTable>())
                templates[(uint)row.Id] = row;

            List<EquipData> candidates = new();
            foreach (EquipData equip in session.character.Equips)
            {
                if (!templates.TryGetValue(equip.TemplateId, out EquipTable? row))
                    continue;

                bool isWeapon = row.Site == 0;
                if (isWeapon != weapons)
                    continue;

                if (row.Star > star)
                    continue;

                if (!IsSpare(equip))
                    continue;

                if (!includeDeveloped && IsDeveloped(equip))
                    continue;

                candidates.Add(equip);
            }

            return candidates;
        }

        /// <summary>
        /// Nothing that is worn, locked, earmarked, recycled or sitting on a pending
        /// resonance - the same conditions the game's own decompose gate checks.
        /// </summary>
        private bool IsSpare(EquipData equip)
        {
            return equip.CharacterId == 0
                && !equip.IsLock
                && !equip.IsRecycle
                && !session.player.IsEquipInTeamPrefab(equip.Id)
                && !session.player.IsEquipInChipGroup(equip.Id)
                && (equip.ResonanceInfo?.Count ?? 0) == 0
                && (equip.UnconfirmedResonanceInfo?.Count ?? 0) == 0
                && !session.PendingEquipResonances.Keys.Any(key => key.Item1 == equip.Id);
        }

        private static bool IsDeveloped(EquipData equip)
        {
            return equip.Level > 1
                || equip.Exp > 0
                || equip.Breakthrough > 0
                || (equip.AwakeSlotList?.Count ?? 0) > 0
                || (equip.WeaponOverrunData?.Level ?? 0) > 0
                || (equip.WeaponOverrunData?.ActiveSuits?.Count ?? 0) > 0
                || (equip.WeaponOverrunData?.ChoseSuit ?? 0) > 0;
        }

        /// <summary>
        /// Derived from the candidate ids and the settings, never stored: a restart
        /// does not invalidate a preview the user is looking at, and a changed set
        /// invalidates it by itself.
        /// </summary>
        private string Token(List<EquipData> candidates, bool weapons, int star, bool includeDeveloped)
        {
            IEnumerable<uint> ids = candidates.Select(equip => equip.Id).OrderBy(id => id);
            string material = string.Join(",", ids)
                + "|" + session.player.PlayerData.Id
                + "|" + (weapons ? "weapons" : "memories")
                + "|" + star
                + "|" + includeDeveloped;

            byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
            return "C1-" + Convert.ToHexString(hash)[..12];
        }

        private static List<string> Sample(List<EquipData> candidates)
        {
            Dictionary<uint, EquipTable> templates = new();
            foreach (EquipTable row in TableReaderV2.Parse<EquipTable>())
                templates[(uint)row.Id] = row;

            List<string> sample = new();
            foreach (EquipData equip in candidates.OrderBy(equip => equip.Id).Take(3))
            {
                if (templates.TryGetValue(equip.TemplateId, out EquipTable? row))
                    sample.Add($"{row.Name} ({row.Star}\\u2605)");
                else
                    sample.Add($"#{equip.Id}");
            }

            return sample;
        }
    }
}