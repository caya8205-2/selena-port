using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.fashion;
using AscNet.Table.V2.share.item;

namespace AscNet.GameServer.Commands
{
    [CommandName("coating")]
    internal class CoatingCommand : Command
    {
        public CoatingCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Unlock character coatings for one character, or all owned character coatings and weapon coatings with 'all'.";

        [Argument(0, @"^unlock$", "The operation selected (unlock)")]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$|^all$", "Character id, or 'all' for all owned character coatings and catalog weapon coatings")]
        string Target { get; set; } = string.Empty;

        [Argument(2, @"^[0-9]+$", "A single coating id belonging to that character", ArgumentFlags.Optional)]
        string Coating { get; set; } = string.Empty;

        /// <summary>
        /// One coating, validated against the character it belongs to: the catalog
        /// must place that coating on this character, and the character must be
        /// owned or ownable. Unlocking a coating on a construct the account does not
        /// have is invisible in game, so it is refused rather than granted silently.
        /// </summary>
        private static HashSet<int> SingleCoating(int characterId, int coatingId)
        {
            FashionTable? fashion = TableReaderV2.Parse<FashionTable>().Find(row => row.Id == coatingId);
            if (fashion is null)
                throw new InvalidOperationException($"Coating {coatingId} is not in the catalog.");

            if (fashion.CharacterId != characterId)
                throw new InvalidOperationException($"Coating {coatingId} belongs to character {fashion.CharacterId}, not {characterId}.");

            if (!Character.IsOwnableCharacter((uint)characterId))
                throw new InvalidOperationException($"Character {characterId} cannot be owned.");

            return new HashSet<int> { coatingId };
        }

        public override void Execute()
        {
            int characterId = Miscs.ParseIntOr(Target);

            switch (Op)
            {
                case "unlock":
                    FashionSyncNotify fashionSync = new();
                    bool changed = false;
                    HashSet<int>? ownedCharacterIds = Target == "all"
                        ? session.character.Characters.Select(character => (int)character.Id).ToHashSet()
                        : null;

                    HashSet<int> fashionIds = string.IsNullOrEmpty(Coating)
                        ? (Target == "all"
                            ? TableReaderV2.Parse<FashionTable>()
                                .Where(fashion => ownedCharacterIds!.Contains(fashion.CharacterId))
                            : TableReaderV2.Parse<FashionTable>()
                                .Where(fashion => fashion.CharacterId == characterId))
                            .Select(fashion => fashion.Id)
                            .ToHashSet()
                        : SingleCoating(characterId, Miscs.ParseIntOr(Coating));

                    List<HeadPortraitList> changedHeads = new();
                    foreach (int fashionId in fashionIds)
                        changed |= RewardHandler.UnlockFashionReward(
                            fashionId,
                            session,
                            fashionSync.FashionList,
                            changedHeads);

                    foreach (int colorId in TableReaderV2.Parse<FashionColorTable>()
                                 .Where(color => fashionIds.Contains(color.OriginalFashionId))
                                 .Select(color => color.Id)
                                 .Distinct())
                    {
                        if (!RewardHandler.UnlockFashionColorReward(colorId, session))
                            continue;

                        changed = true;
                        RewardHandler.UnlockFashionColorReward(colorId, session, fashionSync);
                    }

                    List<WeaponFashionData> changedWeaponFashions = new();
                    if (Target == "all")
                    {
                        IEnumerable<int> weaponFashionIds = TableReaderV2.Parse<ItemTable>()
                            .Where(item => item.ItemType == (int)ItemType.WeaponFashion)
                            .Select(item => item.SubTypeParams.FirstOrDefault())
                            .Where(id => id > 0)
                            .Distinct();

                        foreach (int weaponFashionId in weaponFashionIds)
                            changed |= RewardHandler.UnlockWeaponFashionReward(
                                weaponFashionId,
                                session,
                                changedWeaponFashions
                            );
                    }

                    if (fashionSync.FashionList.Count > 0 || fashionSync.FashionColors.Count > 0)
                        session.SendPush(fashionSync);

                    if (changedWeaponFashions.Count > 0)
                    {
                        session.SendPush(new NotifyWeaponFashionInfo
                        {
                            WeaponFashionDataList = changedWeaponFashions
                        });
                    }

                    if (changedHeads.Count > 0)
                    {
                        session.SendPush(new NotifyHeadPortraitInfos { Heads = changedHeads });
                        session.player.Save();
                    }

                    if (changed)
                        session.character.Save();
                    break;
                default:
                    throw new InvalidOperationException("Invalid operation!");
            }
        }
    }
}
