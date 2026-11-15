using AscNet.Common.Database;
using MongoDB.Driver;
using AscNet.Common.Util;

namespace AscNet.GameServer.Commands
{
    /// <summary>
    /// Local account administration for the control centre: what exists, what has a
    /// player behind it, and how to remove or reset one. Everything is reported through
    /// <see cref="Payload"/> so the desktop app renders facts instead of parsing prose.
    /// <para>
    /// Deleting and resetting are destructive, so both refuse the caller's own UID and
    /// both require the literal word "confirm" - a stray keystroke cannot wipe an account.
    /// </para>
    /// </summary>
    [CommandName("account")]
    internal class AccountCommand : Command
    {
        private object? payload;

        public AccountCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Local account administration: list, show, delete, reset.";

        public override object? Payload => payload;

        [Argument(0, @"^list$|^show$|^delete$|^reset$", "Operation (list, show, delete, reset)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$", "Account UID", ArgumentFlags.Optional)]
        string Target { get; set; } = string.Empty;

        [Argument(2, @"^confirm$", "Required for delete and reset", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Confirm { get; set; } = string.Empty;

        public override void Execute()
        {
            switch (Op.ToLowerInvariant())
            {
                case "list":
                    payload = new
                    {
                        ok = true,
                        total = Account.collection.CountDocuments(FilterDefinition<Account>.Empty),
                        accounts = Account.collection.Find(FilterDefinition<Account>.Empty)
                            .ToList()
                            .OrderBy(account => account.Uid)
                            .Select(Describe)
                            .ToList(),
                    };
                    return;

                case "show":
                    payload = new { ok = true, account = Describe(RequireAccount(Target)) };
                    return;

                case "delete":
                    RequireConfirmation();
                    long deleteUid = ParseUid(Target);
                    RefuseSelf(deleteUid);
                    DeleteDocuments(deleteUid, removeAccount: true);
                    payload = new { ok = true, uid = deleteUid, deleted = true };
                    return;

                case "reset":
                    RequireConfirmation();
                    long resetUid = ParseUid(Target);
                    RefuseSelf(resetUid);
                    DeleteDocuments(resetUid, removeAccount: false);
                    payload = new { ok = true, uid = resetUid, reset = true };
                    return;

                default:
                    throw new InvalidOperationException("Invalid operation!");
            }
        }

        private object Describe(Account account)
        {
            Player? player = Player.collection.Find(candidate => candidate.PlayerData.Id == account.Uid).FirstOrDefault();
            return new
            {
                uid = account.Uid,
                username = account.Username,
                playerPresent = player is not null,
                playerName = player?.PlayerData?.Name,
                level = player?.PlayerData?.Level ?? 0,
            };
        }

        private static long ParseUid(string value)
        {
            long uid = Miscs.ParseIntOr(value);
            if (uid <= 0)
                throw new InvalidOperationException("A numeric UID is required.");
            return uid;
        }

        private static Account RequireAccount(string value)
        {
            long uid = ParseUid(value);
            return Account.collection.Find(account => account.Uid == uid).FirstOrDefault()
                ?? throw new InvalidOperationException($"No account with UID {uid}.");
        }

        private void RequireConfirmation()
        {
            if (!Confirm.Equals("confirm", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("This operation needs the word confirm.");
        }

        private void RefuseSelf(long uid)
        {
            if (session.player.PlayerData.Id == uid)
                throw new InvalidOperationException("Refusing to modify the account currently in use.");
        }

        /// <summary>
        /// Remove the player-side documents for a UID. With <paramref name="removeAccount"/>
        /// the account row goes too (delete); without it the account survives and the next
        /// game login creates a fresh player (reset).
        /// </summary>
        private static void DeleteDocuments(long uid, bool removeAccount)
        {
            Player.collection.DeleteMany(player => player.PlayerData.Id == uid);
            Character.collection.DeleteMany(character => character.Uid == uid);
            Inventory.collection.DeleteMany(inventory => inventory.Uid == uid);
            if (removeAccount)
                Account.collection.DeleteMany(account => account.Uid == uid);
        }
    }
}