using AscNet.Common.Database;
using MongoDB.Driver;

namespace AscNet.GameServer
{
    /// <summary>
    /// Renames an account's uid across every document that carries it: the account, player,
    /// character, inventory and stage documents, the guild membership fields, the leaderboard
    /// entries and the cross-player defence outbox. The caller must refuse a logged-in player:
    /// a live session keeps the old documents in memory and would write them back on its next
    /// save.
    /// </summary>
    public static class AdminUid
    {
        public static Dictionary<string, int> Rename(long oldUid, long newUid)
        {
            Dictionary<string, int> report = new();

            report["accounts"] = (int)Account.collection.UpdateOne(
                account => account.Uid == oldUid,
                Builders<Account>.Update.Set(account => account.Uid, newUid)).ModifiedCount;

            report["players"] = (int)Player.collection.UpdateOne(
                player => player.PlayerData.Id == oldUid,
                Builders<Player>.Update.Set(player => player.PlayerData.Id, newUid)).ModifiedCount;

            report["characters"] = (int)Character.collection.UpdateMany(
                character => character.Uid == oldUid,
                Builders<Character>.Update.Set(character => character.Uid, newUid)).ModifiedCount;

            report["inventory"] = (int)Inventory.collection.UpdateOne(
                inventory => inventory.Uid == oldUid,
                Builders<Inventory>.Update.Set(inventory => inventory.Uid, newUid)).ModifiedCount;

            report["stages"] = (int)Stage.collection.UpdateOne(
                stage => stage.Uid == oldUid,
                Builders<Stage>.Update.Set(stage => stage.Uid, newUid)).ModifiedCount;

            // Leaderboard entries name the player, not the account.
            report["boss inshot ranks"] = (int)BossInshotRankEntry.collection.UpdateMany(
                entry => entry.PlayerId == oldUid,
                Builders<BossInshotRankEntry>.Update.Set(entry => entry.PlayerId, newUid)).ModifiedCount;

            report["transfinite tower ranks"] = (int)TransfiniteTowerRankEntry.collection.UpdateMany(
                entry => entry.PlayerId == oldUid,
                Builders<TransfiniteTowerRankEntry>.Update.Set(entry => entry.PlayerId, newUid)).ModifiedCount;

            report["same color game ranks"] = (int)SameColorGameRankEntry.collection.UpdateMany(
                entry => entry.PlayerId == oldUid,
                Builders<SameColorGameRankEntry>.Update.Set(entry => entry.PlayerId, newUid)).ModifiedCount;

            // Guild membership is a dictionary keyed by uid plus several flat lists, so the
            // document is rewritten in memory.
            // The pending operation is a nested nullable structure the expression tree cannot
            // walk, so the guild documents (a small collection) are filtered in memory.
            List<Guild> candidateGuilds = Guild.collection.Find(FilterDefinition<Guild>.Empty).ToList()
                .Where(guild => guild.MemberIds.Contains(oldUid)
                    || guild.PendingMembershipChanges.Contains(oldUid)
                    || guild.Members.ContainsKey(oldUid)
                    || guild.Applications.Any(application => application.PlayerId == oldUid)
                    || (guild.PendingOperation?.Players.Any(player => player.Uid == oldUid) ?? false))
                .ToList();

            int guilds = 0;
            foreach (Guild guild in candidateGuilds)
            {
                if (guild.Members.Remove(oldUid, out GuildMemberState? member))
                    guild.Members[newUid] = member;
                guild.MemberIds = guild.MemberIds.Select(id => id == oldUid ? newUid : id).ToList();
                guild.PendingMembershipChanges = guild.PendingMembershipChanges
                    .Select(id => id == oldUid ? newUid : id).ToList();
                foreach (GuildApplication application in guild.Applications)
                    if (application.PlayerId == oldUid) application.PlayerId = newUid;
                if (guild.PendingOperation is not null)
                {
                    foreach (GuildPendingPlayer player in guild.PendingOperation.Players)
                        if (player.Uid == oldUid) player.Uid = newUid;
                    foreach (GuildPendingPush push in guild.PendingOperation.Pushes)
                        if (push.Uid == oldUid) push.Uid = newUid;
                }
                uint guildId = guild.Id;
                Guild.collection.ReplaceOne(candidate => candidate.Id == guildId, guild);
                guilds++;
            }
            report["guilds"] = guilds;

            // A pending PvP defence outcome in another player's document names this player as
            // the defender.
            int outbox = 0;
            foreach (Player player in Player.collection.Find(
                         player => player.Theatre6.Pvp.PendingDefenseOutcomes
                             .Any(outcome => outcome.DefenderId == oldUid))
                     .ToList())
            {
                foreach (Theatre6DefenseOutcome outcome in player.Theatre6.Pvp.PendingDefenseOutcomes)
                    if (outcome.DefenderId == oldUid) outcome.DefenderId = newUid;
                player.SaveChecked();
                outbox++;
            }
            report["defence outbox"] = outbox;

            return report;
        }
    }
}
