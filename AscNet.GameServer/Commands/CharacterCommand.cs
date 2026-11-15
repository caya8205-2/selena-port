using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.Common.MsgPack;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.character;

namespace AscNet.GameServer.Commands
{
    [CommandName("character")]
    internal class CharacterCommand : Command
    {
        private object? payload;

        public CharacterCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Characters: add <id|all>, info <id>, rank <id> [next|star|quality|max], shards <id> <count>.";

        public override object? Payload => payload;

        [Argument(0, @"^add$|^info$|^rank$|^shards$", "The operation selected (add, info, rank, shards)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$|^all$", "The target character, value is character id or 'all'")]
        string Target { get; set; } = string.Empty;

        [Argument(2, @"^next$|^star$|^quality$|^max$|^[0-9]+$", "rank mode, or the shard count for shards", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Step { get; set; } = string.Empty;

        public override void Execute()
        {
            int id = Miscs.ParseIntOr(Target);

            switch (Op.ToLowerInvariant())
            {
                case "info":
                    payload = CharacterProgression.Describe(session, RequireCharacterId());
                    return;

                case "rank":
                    payload = CharacterProgression.Advance(
                        session,
                        RequireCharacterId(),
                        string.IsNullOrWhiteSpace(Step) ? "next" : Step);
                    return;

                case "shards":
                    payload = CharacterProgression.GrantShards(session, RequireCharacterId(), RequireShardCount());
                    return;

                case "add":
                    RewardApplicationResult result;
                    if (Target == "all")
                    {
                        HashSet<uint> ownedCharacterIds = session.character.Characters
                            .Select(character => character.Id)
                            .ToHashSet();
                        IEnumerable<Reward> rewards = TableReaderV2.Parse<CharacterTable>()
                            .Where(character => Character.IsOwnableCharacter((uint)character.Id)
                                && !ownedCharacterIds.Contains((uint)character.Id))
                            .Select(character => new Reward { Id = character.Id, Type = RewardType.Character });

                        result = RewardHandler.ApplyRewards(rewards, session);
                    }
                    else
                    {
                        result = RewardHandler.ApplyRewards([ new Reward() { Id = id, Type = RewardType.Character } ], session);
                    }
                    session.inventory.SaveChecked();
                    session.character.SaveChecked();
                    if (result.DormFurnitureChanged || result.GatherRewardIds.Count > 0 || result.HeadPortraitData.Heads.Count > 0)
                        session.player.SaveChecked();
                    result.SendPushes(session);
                    break;
                default:
                    throw new InvalidOperationException("Invalid operation!");
            }
        }

        private int RequireCharacterId()
        {
            int id = Miscs.ParseIntOr(Target);
            if (id <= 0)
                throw new InvalidOperationException("A numeric character id is required.");
            return id;
        }

        private int RequireShardCount()
        {
            int count = Miscs.ParseIntOr(Step);
            if (count <= 0)
                throw new InvalidOperationException("shards needs a positive count: /character shards <id> <count>.");
            return count;
        }
    }
}
