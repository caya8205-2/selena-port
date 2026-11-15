using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Common.Util;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.guild;

namespace AscNet.GameServer.Commands
{
    /// <summary>
    /// The guild of the account the panel acts as. Membership, rank and every guild balance are
    /// read through <see cref="GuildModule"/>, and a grant runs through its own mutation and
    /// persist path, so limits, receipts and pushes stay the ones the game itself uses.
    /// </summary>
    [CommandName("guild")]
    internal class GuildCommand : Command
    {
        // The economy handlers name these ids: 40 is build progress toward the next guild level,
        // 38 is the contribution pool the guild spends as funds.
        private const int BuildItemId = 40;
        private const int ContributionItemId = 38;

        private object? payload;

        public GuildCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help =>
            "Guild of this account: info, grant <exp|fund|contribution> <amount> [confirm]. " +
            "exp adds build progress, fund and contribution add to the contribution pool the guild spends as funds.";

        public override object? Payload => payload;

        [Argument(0, @"^info$|^grant$", "Operation (info, grant)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^exp$|^fund$|^contribution$", "Resource to grant", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Kind { get; set; } = string.Empty;

        [Argument(2, @"^[0-9]+$", "Amount to grant", ArgumentFlags.Optional)]
        string Amount { get; set; } = string.Empty;

        [Argument(3, @"^confirm$", "Accept a grant above the game's daily donation limit", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Confirm { get; set; } = string.Empty;

        public override void Execute()
        {
            if (Op.Equals("info", StringComparison.OrdinalIgnoreCase))
            {
                payload = Describe();
                return;
            }

            payload = Grant();
        }

        private object Describe()
        {
            long uid = session.player.PlayerData.Id;
            Guild guild = GuildModule.FindMembership(uid)
                ?? throw new CommandMessageCallbackException("this account is not in a guild.");

            GuildLevelTable level = LevelRow(guild);
            GuildMemberState? member = guild.Members.GetValueOrDefault(uid);
            int rank = GuildModule.Rank(guild, uid);

            return new
            {
                ok = true,
                guild = new
                {
                    id = guild.Id,
                    name = guild.Name,
                    iconId = guild.IconId,
                    level = guild.Level,
                    build = guild.Build,
                    funds = guild.ContributeLeft,
                    contributionIn7Days = GuildModule.RecentContribution(guild),
                    giftContribute = guild.GiftContribute,
                    talentPoint = guild.TalentPoint,
                    shopCoin = guild.ShopCoin,
                    memberCount = guild.MemberIds.Count(id => GuildModule.Rank(guild, id) != 5),
                    touristCount = guild.MemberIds.Count(id => GuildModule.Rank(guild, id) == 5),
                },
                member = new
                {
                    uid,
                    rank,
                    rankName = RankName(rank),
                    joinedAt = member?.JoinedAt ?? 0,
                    weekContribution = member?.WeekContribute ?? 0,
                    totalContribution = member?.TotalContribute ?? 0,
                    activeContribution = member?.ActiveContribute ?? 0,
                    contributionIn7Days = GuildModule.RecentMemberContribution(guild, uid),
                    popularity = member?.Popularity ?? 0,
                    pendingContributeReward = session.player.GuildState?.PendingContributeReward ?? 0,
                },
                caps = new
                {
                    level = level.Level,
                    capacity = level.Capacity,
                    touristCapacity = level.PositionNum.Count > 2 ? level.PositionNum[2] : 0,
                    buildForNextLevel = TableReaderV2.Parse<GuildLevelTable>().Any(row => row.Level > guild.Level) ? level.Build : 0,
                    talentPointOnLevelUp = level.TalentPoint,
                    dailyDonationLimit = GuildModule.LocalGuildWishPolicy.DailyDonationLimit,
                    grantable = new[] { "exp", "fund", "contribution" },
                },
            };
        }

        private object Grant()
        {
            string kind = Kind.ToLowerInvariant();
            if (kind is not ("exp" or "fund" or "contribution"))
                throw new CommandMessageCallbackException("grant needs a resource: /guild grant <exp|fund|contribution> <amount>.");

            int amount = Miscs.ParseIntOr(Amount);
            if (amount <= 0)
                throw new CommandMessageCallbackException("grant needs a positive amount: /guild grant <exp|fund|contribution> <amount>.");

            long uid = session.player.PlayerData.Id;
            Guild guild = GuildModule.FindMembership(uid)
                ?? throw new CommandMessageCallbackException("this account is not in a guild.");

            int itemId = kind == "exp" ? BuildItemId : ContributionItemId;
            long balance = itemId == BuildItemId ? guild.Build : guild.ContributeLeft;
            if (balance + amount > int.MaxValue)
                throw new CommandMessageCallbackException($"this grant would overflow the guild's {StoreName(itemId)} balance of {balance}.");

            // The pool grant is the game's donation flow, which counts the acting member's
            // contribution and is capped per day for players; a GM amount above that cap has to
            // say so instead of quietly exceeding a game limit.
            bool confirmed = Confirm.Equals("confirm", StringComparison.OrdinalIgnoreCase);
            int dailyLimit = GuildModule.LocalGuildWishPolicy.DailyDonationLimit;
            if (itemId == ContributionItemId && amount > dailyLimit && !confirmed)
                throw new CommandMessageCallbackException(
                    $"{kind} {amount} is above the game's daily donation limit of {dailyLimit}; repeat with confirm to grant it anyway.");

            int buildBefore = guild.Build;
            int fundsBefore = guild.ContributeLeft;
            bool atMaxLevel = !TableReaderV2.Parse<GuildLevelTable>().Any(row => row.Level > guild.Level);

            try
            {
                GuildModule.Commit(session, guild, mutation => mutation.AddGoods(uid, itemId, amount));
            }
            catch (ServerCodeException exception)
            {
                throw new CommandMessageCallbackException($"the guild handlers refused this grant with code {exception.Code}.");
            }

            Guild persisted = Guild.FindById(guild.Id)
                ?? throw new CommandMessageCallbackException("the guild row disappeared while granting.");
            GuildMemberState? member = persisted.Members.GetValueOrDefault(uid);

            return new
            {
                ok = true,
                kind,
                amount,
                itemId,
                store = StoreName(itemId),
                guildId = persisted.Id,
                confirmed,
                before = new { build = buildBefore, funds = fundsBefore },
                after = new
                {
                    level = persisted.Level,
                    build = persisted.Build,
                    funds = persisted.ContributeLeft,
                    talentPoint = persisted.TalentPoint,
                },
                member = new
                {
                    rank = GuildModule.Rank(persisted, uid),
                    weekContribution = member?.WeekContribute ?? 0,
                    totalContribution = member?.TotalContribute ?? 0,
                },
                note = itemId == ContributionItemId
                    ? "the contribution pool and the acting member's contribution are one flow in this server: this grant credits both"
                    : atMaxLevel
                        ? "the guild is at its highest authored level, so build converts into talent points"
                        : null,
            };
        }

        private GuildLevelTable LevelRow(Guild guild) =>
            TableReaderV2.Parse<GuildLevelTable>().FirstOrDefault(row => row.Level == guild.Level)
            ?? throw new CommandMessageCallbackException($"the guild sits at level {guild.Level}, which GuildLevel.tsv does not define.");

        private static string StoreName(int itemId) => itemId == BuildItemId ? "build" : "contribution pool";

        private static string RankName(int rank) => rank switch
        {
            9 => "none",
            5 => "tourist",
            _ => TableReaderV2.Parse<GuildPositionTable>().FirstOrDefault(row => row.Id == rank)?.Name ?? "unknown",
        };
    }
}