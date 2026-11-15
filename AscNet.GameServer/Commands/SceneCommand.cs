using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.Table.V2.share.photomode;

namespace AscNet.GameServer.Commands
{
    [CommandName("scene")]
    internal class SceneCommand : Command
    {
        public SceneCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Unlock one scene background by id, or every background with 'all'.";

        [Argument(0, @"^unlock$", "The operation selected (unlock)")]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$|^all$", "A scene background id, or 'all' for the whole catalog", ArgumentFlags.IgnoreCase)]
        string Target { get; set; } = string.Empty;

        public override void Execute()
        {
            if (Op != "unlock")
                throw new InvalidOperationException("Invalid operation!");

            List<int> catalogIds = TableReaderV2.Parse<BackgroundTable>()
                .Where(background => background.Id > 0 && background.SceneModelId > 0)
                .Select(background => background.Id)
                .Distinct()
                .Order()
                .ToList();

            // "all" keeps the bulk form; a numeric target unlocks just that background, which is
            // what the panel's Perform sends when one entry is picked from the catalog.
            List<int> requested = new();
            if (Target.Equals("all", StringComparison.OrdinalIgnoreCase))
            {
                requested = catalogIds;
            }
            else
            {
                int id = Miscs.ParseIntOr(Target);
                if (!catalogIds.Contains(id))
                    throw new CommandMessageCallbackException($"Unknown scene background id: {id}.");

                requested.Add(id);
            }

            List<int> owned = session.player.OwnedBackgroundIds ?? new List<int>();
            List<int> added = requested.Where(id => !owned.Contains(id)).ToList();

            if (added.Count == 0)
            {
                throw new CommandMessageCallbackException(requested.Count == 1
                    ? "That scene background is already unlocked."
                    : "All scene backgrounds are already unlocked.");
            }

            List<int> original = owned.ToList();
            session.player.OwnedBackgroundIds = owned.Union(requested).Distinct().Order().ToList();

            try
            {
                session.player.SaveChecked();
            }
            catch
            {
                session.player.OwnedBackgroundIds = original;
                throw new CommandMessageCallbackException("Failed to persist scene unlocks.");
            }

            foreach (int id in added)
                session.SendPush(new NotifyAddBackground { BackgroundId = id });

            throw new CommandMessageCallbackException(added.Count == 1
                ? "Unlocked 1 scene background."
                : $"Unlocked {added.Count} scene background(s).");
        }
    }
}