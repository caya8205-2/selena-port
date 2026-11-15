using AscNet.Common.Database;
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