using AscNet.Common.Util;

namespace AscNet.GameServer.Commands
{
    /// <summary>
    /// Send a mail from inside the game: one account or every account, optionally carrying one
    /// item attachment. The mail itself is the ordinary <see cref="AscNet.Common.Database.PlayerMail"/>
    /// row, delivered by <see cref="MailDelivery"/>, so the same call serves the panel.
    /// <para>
    /// <c>0 0</c> means "no attachment" instead of a magic word: the two numbers are either both
    /// zero or both a real id and count, so an attachment can never be half-specified.
    /// </para>
    /// </summary>
    [CommandName("mail")]
    internal class MailCommand : Command
    {
        private object? payload;

        public MailCommand(Session session, string[] args, bool validate = true) : base(session, args, validate) { }

        public override string Help => "Send a mail: /mail send <uid|all> <itemId|0> <count|0> <subject> [body]. Use 0 0 for no attachment.";

        public override object? Payload => payload;

        [Argument(0, @"^send$", "Operation (send)", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^all$|^[0-9]+$", "Account UID, or all", ArgumentFlags.IgnoreCase)]
        string Target { get; set; } = string.Empty;

        [Argument(2, @"^[0-9]+$", "Attachment id, 0 for none")]
        string AttachmentId { get; set; } = "0";

        [Argument(3, @"^[0-9]+$", "Attachment count, 0 for none")]
        string AttachmentCount { get; set; } = "0";

        [Argument(4, @"^.+$", "Subject; any words after it become the body")]
        string Subject { get; set; } = string.Empty;

        public override void Execute()
        {
            int attachmentId = Miscs.ParseIntOr(AttachmentId);
            int attachmentCount = Miscs.ParseIntOr(AttachmentCount);
            if ((attachmentId == 0) != (attachmentCount == 0))
                throw new InvalidOperationException("Give both an attachment id and its count, or 0 0 for none.");

            string subject = Subject;
            string body = args.Length > 5 ? string.Join(' ', args.Skip(5)) : string.Empty;
            if (string.IsNullOrWhiteSpace(subject))
                throw new InvalidOperationException("A subject is required.");

            MailDeliveryReport report = MailDelivery.Send(
                Target,
                "Selena",
                subject,
                body,
                attachmentId == 0
                    ? []
                    : [new MailAttachmentRequest { TemplateId = attachmentId, Count = attachmentCount }]);

            payload = new
            {
                ok = report.Ok,
                delivered = report.Delivered,
                skipped = report.Skipped,
                results = report.Results
                    .Select(result => new { uid = result.Uid, ok = result.Ok, mailId = result.MailId, reason = result.Reason })
                    .ToList(),
            };
        }
    }
}