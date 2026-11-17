using AscNet.Common.Database;

namespace AscNet.GameServer
{
    /// <summary>
    /// The account an administrative command acts on. The control centre picks that account from
    /// the database instead of a sign-in, so the live session is used when the game is connected
    /// (the command's pushes reach the client at once) and an offline session over the same
    /// documents is built when it is not. Either way the command layer runs unchanged, and there
    /// are never two sessions writing the same player.
    /// </summary>
    public static class AdminSession
    {
        public sealed record Handle(Session Session, bool Live);

        public static Handle Open(long uid)
        {
            if (uid <= 0)
                throw new InvalidOperationException("a positive account UID is required.");

            Session? live = Server.Instance.SessionFromUID(uid);
            if (live is not null)
                return new Handle(live, true);

            Player player = Player.TryFromPlayerId(uid)
                ?? throw new InvalidOperationException("this account has no player yet - log in once from the game");
            Character character = Character.FromUid(uid, player.GatherRewards);
            Inventory inventory = Inventory.FromUid(uid);

            Session session = new($"admin-{uid}", player, character, inventory);
            // The login path assigns the stage module; an offline session needs the same one, or a stage command
            // dereferences nothing and answers "Object reference not set to an instance of an object".
            session.stage = Stage.FromUid(player.PlayerData.Id);

            return new Handle(session, false);
        }
    }
}