using AscNet.Common.Database;
using AscNet.GameServer.Handlers;
using MongoDB.Driver;

namespace AscNet.GameServer
{
    /// <summary>
    /// One attachment on a mail built by the panel or the <c>mail</c> command.
    /// </summary>
    public sealed class MailAttachmentRequest
    {
        public int TemplateId { get; set; }
        public int Count { get; set; }
    }

    public sealed class MailDeliveryOutcome
    {
        public long Uid { get; set; }
        public bool Ok { get; set; }
        public string? MailId { get; set; }
        public string? Reason { get; set; }
    }

    public sealed class MailDeliveryReport
    {
        public bool Ok { get; set; }
        public int Delivered { get; set; }
        public int Skipped { get; set; }
        public List<MailDeliveryOutcome> Results { get; set; } = new();
    }

    /// <summary>
    /// Delivers a mail to one account or to every account, without a game session.
    /// <para>
    /// The mail is an ordinary <see cref="PlayerMail"/> row, so the client's own mailbox
    /// reads it and the ordinary claim path pays the attachments; nothing new is invented
    /// on the wire. A player who is online gets the mailbox push straight away instead of
    /// having to relog, and an offline player gets the row in their next login.
    /// </para>
    /// <para>
    /// Attachments are validated by the same projection the claim uses
    /// (<see cref="MailModule.CreateAttachment"/>), so a delivered mail can always be claimed.
    /// </para>
    /// </summary>
    public static class MailDelivery
    {
        public const string AllRecipients = "all";

        public static MailDeliveryReport Send(
            string recipient,
            string sender,
            string subject,
            string content,
            IReadOnlyList<MailAttachmentRequest> attachments)
        {
            if (string.IsNullOrWhiteSpace(subject))
                throw new InvalidOperationException("A subject is required.");

            List<PlayerMailRewardGoods> goods = new();
            foreach (MailAttachmentRequest attachment in attachments)
            {
                PlayerMailRewardGoods? snapshot = MailModule.CreateAttachment(attachment.TemplateId, attachment.Count);
                if (snapshot is null)
                    throw new InvalidOperationException(
                        $"Attachment {attachment.TemplateId} x{attachment.Count} cannot be granted by mail.");
                goods.Add(snapshot);
            }

            List<long> uids = ResolveRecipients(recipient);
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            string sendName = string.IsNullOrWhiteSpace(sender) ? "Selena" : sender.Trim();
            MailDeliveryReport report = new() { Ok = false };

            foreach (long uid in uids)
            {
                Session? session = Server.Instance.SessionFromUID(uid);
                Player? player = session?.player ?? Player.TryFromPlayerId(uid);
                if (player is null)
                {
                    report.Skipped++;
                    report.Results.Add(new MailDeliveryOutcome
                    {
                        Uid = uid,
                        Ok = false,
                        Reason = "this account has no player yet - log in once from the game",
                    });
                    continue;
                }

                PlayerMail mail = new()
                {
                    Id = $"admin:{uid}:{now}:{Guid.NewGuid():N}",
                    GroupId = 0,
                    Type = 0,
                    Status = 0,
                    SendName = sendName,
                    Title = subject.Trim(),
                    Content = content ?? string.Empty,
                    CreateTime = now,
                    SendTime = now,
                    ExpireTime = 0,
                    RewardGoodsList = goods.Count == 0 ? null : goods.Select(Clone).ToList(),
                };

                player.Mails.Add(mail);
                try
                {
                    player.SaveChecked();
                }
                catch (Exception ex)
                {
                    player.Mails.Remove(mail);
                    report.Skipped++;
                    report.Results.Add(new MailDeliveryOutcome
                    {
                        Uid = uid,
                        Ok = false,
                        Reason = $"save failed: {ex.Message}",
                    });
                    continue;
                }

                // Online players see it without relogging; the row is already durable, so a
                // failed push only costs a refresh.
                if (session is not null)
                {
                    try { session.SendPush(MailModule.BuildNotifyMails(player, now)); }
                    catch (Exception ex) { Server.log.Warn($"mail push to {uid} failed: {ex.Message}"); }
                }

                report.Delivered++;
                report.Results.Add(new MailDeliveryOutcome { Uid = uid, Ok = true, MailId = mail.Id });
            }

            report.Ok = report.Delivered > 0 && report.Skipped == 0;
            return report;
        }

        /// <summary>
        /// The mails on one account, newest first, read from the live session when the player is
        /// online (it is the copy that will be saved) and from the database otherwise.
        /// </summary>
        public static List<PlayerMail>? Read(long uid)
        {
            Session? session = Server.Instance.SessionFromUID(uid);
            Player? player = session?.player ?? Player.TryFromPlayerId(uid);
            return player?.Mails?.OrderByDescending(mail => mail.CreateTime).ToList();
        }

        private static List<long> ResolveRecipients(string recipient)
        {
            List<long> uids;
            if (recipient.Trim().Equals(AllRecipients, StringComparison.OrdinalIgnoreCase))
            {
                uids = Account.collection.Find(FilterDefinition<Account>.Empty)
                    .ToList()
                    .Select(account => account.Uid)
                    .OrderBy(uid => uid)
                    .ToList();
                if (uids.Count == 0)
                    throw new InvalidOperationException("there are no accounts to send to.");
            }
            else if (long.TryParse(recipient.Trim(), out long uid) && uid > 0)
            {
                if (!Account.collection.Find(account => account.Uid == uid).Any())
                    throw new InvalidOperationException($"there is no account with UID {uid}.");
                uids = [uid];
            }
            else
            {
                throw new InvalidOperationException("the recipient must be an account UID or \"all\".");
            }
            return uids;
        }

        private static PlayerMailRewardGoods Clone(PlayerMailRewardGoods goods) => new()
        {
            RewardType = goods.RewardType,
            TemplateId = goods.TemplateId,
            Count = goods.Count,
            Level = goods.Level,
            Quality = goods.Quality,
            Grade = goods.Grade,
            Breakthrough = goods.Breakthrough,
            ConvertFrom = goods.ConvertFrom,
            IsGift = goods.IsGift,
            RewardMulti = goods.RewardMulti,
            Id = goods.Id,
        };
    }
}