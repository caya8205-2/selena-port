using AscNet.Common.Database;
using AscNet.GameServer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using Newtonsoft.Json;

namespace AscNet.SDKServer.Controllers
{
    /// <summary>
    /// Administration endpoints for the desktop control centre.
    /// <para>
    /// They deliberately do not use the in-game command layer: that layer requires a live
    /// session and answers "Player is offline!" otherwise, which is correct for gameplay
    /// but wrong for administration. These endpoints read and write the documents directly
    /// and are guarded by a token stored beside the server config.
    /// </para>
    /// </summary>
    public class AdminController : IRegisterable
    {
        public static void Register(WebApplication app)
        {
            // Create the token now, not on the first request: the desktop app has to read it
            // from disk without guessing, and a missing header would short-circuit before
            // the lazy initialiser ever ran.
            AdminToken.Ensure();

            app.MapGet("/api/admin/accounts", (HttpContext ctx) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                var accounts = Account.collection.Find(FilterDefinition<Account>.Empty).ToList()
                    .OrderBy(a => a.Uid)
                    .Select(a => Describe(a))
                    .ToList();

                return Json(new { ok = true, total = accounts.Count, accounts });
            });

            app.MapPost("/api/admin/accounts", async (HttpContext ctx, [FromBody] CreateAccountRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);
                if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                    return Json(new { ok = false, msg = "username and password are required" }, 400);

                if (Account.collection.Find(a => a.Username == request.Username).Any())
                    return Json(new { ok = false, msg = "that username already exists" }, 409);

                var account = Account.Create(request.Username, request.Password);
                return Json(new { ok = true, account = Describe(account) });
            });

            app.MapPost("/api/admin/accounts/{uid:long}/player", (HttpContext ctx, long uid, [FromBody] PlayerRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                var account = Find(uid);
                if (account is null) return Json(new { ok = false, msg = "no such account" }, 404);

                var player = Player.collection.Find(p => p.PlayerData.Id == uid).FirstOrDefault();
                if (player is null) return Json(new { ok = false, msg = "this account has no player yet - log in once from the game" }, 409);

                if (!string.IsNullOrWhiteSpace(request.Name)) player.PlayerData.Name = request.Name;
                if (request.Level is > 0) player.PlayerData.Level = request.Level.Value;
                player.SaveChecked();

                return Json(new { ok = true, account = Describe(account) });
            });

            app.MapPost("/api/admin/accounts/{uid:long}/delete", (HttpContext ctx, long uid) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);
                DeleteDocuments(uid, removeAccount: true);
                return Json(new { ok = true, uid, deleted = true });
            });

            app.MapPost("/api/admin/accounts/{uid:long}/reset", (HttpContext ctx, long uid) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);
                DeleteDocuments(uid, removeAccount: false);
                return Json(new { ok = true, uid, reset = true });
            });

            // Mail is an administration action, not only a chat command: the command layer needs
            // a live session, and mailing an account that is not logged in is the normal case.
            app.MapPost("/api/admin/mail", (HttpContext ctx, [FromBody] SendMailRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                try
                {
                    MailDeliveryReport report = MailDelivery.Send(
                        request.Recipient ?? string.Empty,
                        request.Sender ?? string.Empty,
                        request.Subject ?? string.Empty,
                        request.Body ?? string.Empty,
                        request.Attachments ?? []);
                    return Json(new
                    {
                        ok = report.Ok,
                        delivered = report.Delivered,
                        skipped = report.Skipped,
                        results = report.Results.Select(result => new
                        {
                            uid = result.Uid,
                            ok = result.Ok,
                            mailId = result.MailId,
                            reason = result.Reason,
                        }).ToList(),
                    });
                }
                catch (InvalidOperationException ex)
                {
                    return Json(new { ok = false, msg = ex.Message }, 400);
                }
            });

            // Read-back for the panel: what is in one account's mailbox right now. Newest first,
            // live session when the player is online, database otherwise.
            app.MapGet("/api/admin/mail", (HttpContext ctx, long uid) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);
                if (Find(uid) is null) return Json(new { ok = false, msg = "no such account" }, 404);

                List<PlayerMail>? mails = MailDelivery.Read(uid);
                if (mails is null)
                    return Json(new { ok = false, msg = "this account has no player yet - log in once from the game" }, 409);

                return Json(new
                {
                    ok = true,
                    uid,
                    total = mails.Count,
                    mails = mails.Select(mail => new
                    {
                        id = mail.Id,
                        title = mail.Title,
                        sendName = mail.SendName,
                        content = mail.Content,
                        status = mail.Status,
                        createTime = mail.CreateTime,
                        expireTime = mail.ExpireTime,
                        attachments = mail.RewardGoodsList?.Select(goods => new
                        {
                            templateId = (int)goods.TemplateId,
                            count = goods.Count,
                            rewardType = goods.RewardType,
                        }).ToList(),
                    }).ToList(),
                });
            });

            // The command layer, for an account chosen from the database instead of a signed-in
            // game session: the player panel's acting-account picker and the character builder
            // both go through here. AdminSession reuses the live session when the game is
            // connected, so a command's pushes still reach the client.
            app.MapPost("/api/admin/command/{name}", (HttpContext ctx, string name, [FromBody] AdminCommandRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.Commands.Command? command;
                bool live;
                try
                {
                    AdminSession.Handle handle = AdminSession.Open(request.Uid);
                    live = handle.Live;
                    command = AscNet.GameServer.Commands.CommandFactory.CreateCommand(
                        name,
                        handle.Session,
                        (request.Args ?? new()).ToArray());
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                if (command is null)
                    return Json(new { ok = false, msg = "Command does not exist!" }, 404);

                try
                {
                    command.Execute();
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = command.Payload, live });
            });

            app.MapPost("/api/admin/tune", (HttpContext ctx, [FromBody] AscNet.GameServer.TuneRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.TuneReport report;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(request.Uid);
                    live = handle.Live;
                    report = AscNet.GameServer.TuneBuilder.Apply(handle.Session, request);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = report, live });
            });

            app.MapPost("/api/admin/tune-bulk", (HttpContext ctx, [FromBody] AscNet.GameServer.TuneBulkRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.TuneBulkReport report;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(request.Uid);
                    live = handle.Live;
                    report = AscNet.GameServer.TuneBuilder.ApplyBulk(handle.Session, request);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = report, live });
            });

            app.MapPost("/api/admin/tune-cub-bulk", (HttpContext ctx, [FromBody] AscNet.GameServer.TuneCubBulkRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.TuneCubBulkReport report;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(request.Uid);
                    live = handle.Live;
                    report = AscNet.GameServer.TuneBuilder.ApplyCubBulk(handle.Session, request);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = report, live });
            });

            app.MapGet("/api/admin/tune-cub-state", (HttpContext ctx, long uid) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.TuneCubStateReport state;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(uid);
                    live = handle.Live;
                    state = AscNet.GameServer.TuneBuilder.CubState(handle.Session);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = state, live });
            });

            app.MapPost("/api/admin/endgame-apply", (HttpContext ctx, [FromBody] AscNet.GameServer.EndgameApplyRequest request) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.EndgameApplyReport report;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(request.Uid);
                    live = handle.Live;
                    report = AscNet.GameServer.EndgameBuilder.Apply(handle.Session, request);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = report, live });
            });

            app.MapGet("/api/admin/endgame-catalog", (HttpContext ctx, long uid) =>
            {
                if (!Authorised(ctx)) return Unauthorised(ctx);

                AscNet.GameServer.EndgameCatalog catalog;
                bool live;
                try
                {
                    AscNet.GameServer.AdminSession.Handle handle = AscNet.GameServer.AdminSession.Open(uid);
                    live = handle.Live;
                    catalog = AscNet.GameServer.EndgameBuilder.Catalog(handle.Session);
                }
                catch (Exception ex)
                {
                    return Json(new { ok = false, msg = ex.InnerException?.Message ?? ex.Message }, 400);
                }

                return Json(new { ok = true, msg = "OK", data = catalog, live });
            });
        }

        private static Account? Find(long uid) =>
            Account.collection.Find(account => account.Uid == uid).FirstOrDefault();

        private static object Describe(Account account)
        {
            var player = Player.collection.Find(p => p.PlayerData.Id == account.Uid).FirstOrDefault();
            return new
            {
                uid = account.Uid,
                username = account.Username,
                playerPresent = player is not null,
                playerName = player?.PlayerData?.Name,
                level = player?.PlayerData?.Level ?? 0,
            };
        }

        private static void DeleteDocuments(long uid, bool removeAccount)
        {
            Player.collection.DeleteMany(player => player.PlayerData.Id == uid);
            Character.collection.DeleteMany(character => character.Uid == uid);
            Inventory.collection.DeleteMany(inventory => inventory.Uid == uid);
            if (removeAccount)
                Account.collection.DeleteMany(account => account.Uid == uid);
        }

        private static bool Authorised(HttpContext ctx) =>
            ctx.Request.Headers.TryGetValue("X-Admin-Token", out var provided)
            && provided.ToString() == AdminToken.Value;

        private static IResult Unauthorised(HttpContext ctx) =>
            Json(new { ok = false, msg = "admin token missing or wrong" }, 401);

        private static IResult Json(object payload, int statusCode = 200) =>
            Results.Text(JsonConvert.SerializeObject(payload), "application/json", statusCode: statusCode);
    }

    public sealed class CreateAccountRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public sealed class PlayerRequest
    {
        public string? Name { get; set; }
        public long? Level { get; set; }
    }

    public sealed class AdminCommandRequest
    {
        public long Uid { get; set; }
        public List<string>? Args { get; set; }
    }

    public sealed class SendMailRequest
    {
        public string? Recipient { get; set; }
        public string? Sender { get; set; }
        public string? Subject { get; set; }
        public string? Body { get; set; }
        public List<MailAttachmentRequest>? Attachments { get; set; }
    }

    /// <summary>
    /// The local admin token. Generated once next to the server config so the desktop app
    /// can read it and no external client can guess it; the endpoints stay loopback-only.
    /// </summary>
    public static class AdminToken
    {
        private static string? value;

        public static string Value => value ??= Load();

        public static string Ensure() => Value;

        private static string Load()
        {
            var path = Path.Combine(AppContext.BaseDirectory, "admin-token.txt");
            if (File.Exists(path))
            {
                var existing = File.ReadAllText(path).Trim();
                if (existing.Length >= 16) return existing;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var token = Guid.NewGuid().ToString("N");
            File.WriteAllText(path, token);
            return token;
        }
    }
}