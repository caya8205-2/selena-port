using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.player;

namespace AscNet.GameServer.Commands
{
    [CommandName("level")]
    internal class LevelCommand : Command
    {
        public LevelCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Command to change the Commandant level";

        [Argument(0, @"^[0-9]+$|^max$", "The target level, value is number or 'max'")]
        string Level { get; set; } = string.Empty;

        public override void Execute()
        {
            List<PlayerTable> playerLevels = TableReaderV2.Parse<PlayerTable>();
            int level = Miscs.ParseIntOr(Level);

            if (Level == "max")
            {
                session.player.PlayerData.Level = playerLevels.OrderByDescending(x => x.Level).First().Level;
                // The command persists on its own: an administrative run has no client that would save on
                // logout, and a live session only flushes later.
                session.player.SaveChecked();
                session.SendPush(new NotifyPlayerLevel { Level = (int)session.player.PlayerData.Level });
                session.ExpSanityCheck();
                return;
            }

            if (!playerLevels.Any(x => x.Level == level))
                throw new ArgumentException("Invalid Level!");

            bool lowered = session.player.PlayerData.Level > level;
            session.player.PlayerData.Level = level;
            session.player.SaveChecked();

            if (lowered)
            {
                // The client only accepts a lower level after a re-login. With no socket there is nothing to
                // reconnect, and the save above is the whole job.
                if (session.client is not null)
                {
                    // Waiting for SendChatResponse, pls fix later
                    Task.Run(() =>
                    {
                        // ReconnectPlayerLogout
                        session.SendPush(new ForceLogoutNotify() { Code = 1030 });
                        session.DisconnectProtocol();
                    });
                }
                return;
            }

            session.SendPush(new NotifyPlayerLevel { Level = (int)session.player.PlayerData.Level });
            session.ExpSanityCheck();
        }
    }
}
