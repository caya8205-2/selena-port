using System.Net;
using AscNet.WebPanel;
using Microsoft.Extensions.FileProviders;

// Selena-port web panel: static GM/player UI plus a pass-through to the AscNet
// SDK server. Every state change goes through the same HTTP endpoints the game
// uses (/api/AscNet/login, /api/AscNet/commands, /api/AscNet/command/{name}),
// so the panel behaves exactly like the in-game chat commands.

var builder = WebApplication.CreateBuilder(args);

var panelUrl = Environment.GetEnvironmentVariable("SELENA_PANEL_URL")
               ?? builder.Configuration["Panel:Url"]
               ?? "http://127.0.0.1:8081";

var sdkBaseUrl = Environment.GetEnvironmentVariable("SELENA_SDK_URL")
                 ?? builder.Configuration["Panel:SdkUrl"]
                 ?? "http://127.0.0.1:8085";

var configuredWebUi = builder.Configuration["Panel:WebUi"];
var webRoot = Environment.GetEnvironmentVariable("SELENA_WEB_UI")
              ?? (string.IsNullOrWhiteSpace(configuredWebUi) ? null : configuredWebUi)
              ?? FindWebUi(builder.Environment.ContentRootPath)
              ?? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "web-ui"));

// The launcher runs this from bin/, the dev loop runs it from the project
// directory: walk up until the named folder of the repository is found.
static string? FindDirectory(string name, string start)
{
    var dir = new DirectoryInfo(start);
    for (var depth = 0; depth < 8 && dir is not null; depth++)
    {
        var candidate = Path.Combine(dir.FullName, name);
        if (Directory.Exists(candidate))
        {
            return candidate;
        }

        dir = dir.Parent;
    }

    return null;
}

static string? FindWebUi(string start) => FindDirectory("web-ui", start);

builder.WebHost.UseUrls(panelUrl);

var resourcesRoot = Environment.GetEnvironmentVariable("SELENA_RESOURCES")
                    ?? FindDirectory("Resources", builder.Environment.ContentRootPath)
                    ?? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "Resources"));

builder.Services.AddSingleton(sp => new Catalog(resourcesRoot, sp.GetRequiredService<ILogger<Catalog>>()));
builder.Services.AddHttpClient("sdk", client =>
{
    client.BaseAddress = new Uri(sdkBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(30);
});

var app = builder.Build();

if (!Directory.Exists(webRoot))
{
    app.Logger.LogError("Web UI directory not found: {WebRoot}", webRoot);
}

var files = new PhysicalFileProvider(webRoot);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = files,
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream",
});

// Convenience routes so /gm and /player work without the file name.
app.MapGet("/", () => Results.Redirect("/gm/index.html"));
app.MapGet("/gm", () => Results.Redirect("/gm/index.html"));
app.MapGet("/player", () => Results.Redirect("/player/index.html"));

app.MapGet("/api/panel/info", () => Results.Json(new
{
    name = "Selena-port panel",
    sdk = sdkBaseUrl,
    webUi = webRoot,
    resources = resourcesRoot,
}));

// Read-only catalog for the panel's search dropdowns (items, characters,
// equips, stages). Served from the server's own TSV tables; the upstream
// server keeps its typed readers and is not involved.
app.MapGet("/api/panel/catalog/{kind}", (string kind, Catalog catalog) =>
    catalog.TryGet(kind, out var entries)
        ? Results.Json(new { code = 0, kind, count = entries.Length, entries })
        : Results.Json(new { code = -1, kind, msg = "unknown or missing catalog" }, statusCode: 404));

// Coatings of one character, for the per-coating picker. Separate from the flat
// catalogs because it depends on a character selection.
app.MapGet("/api/panel/coatings/{characterId:long}", (long characterId, Catalog catalog) =>
{
    var entries = catalog.CoatingsFor(characterId);
    return Results.Json(new { code = 0, characterId, count = entries.Length, entries });
});

// Pass-through: the browser only ever talks to this process, which keeps the
// SDK server bound to loopback and avoids cross-origin rules in the panel JS.
app.Map("/api/{**rest}", async (HttpContext ctx, IHttpClientFactory factory) =>
{
    var client = factory.CreateClient("sdk");
    var target = "api/" + (ctx.Request.Path.Value ?? "/api/")["/api/".Length..].TrimStart('/');

    using var upstream = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), target + ctx.Request.QueryString);

    if (ctx.Request.ContentLength is > 0 || ctx.Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            // Read the body into a byte[] first: a MemoryStream behind a StreamContent
            // would be disposed before the upstream request is sent.
            using var buffer = new MemoryStream();
            await ctx.Request.Body.CopyToAsync(buffer, ctx.RequestAborted);
            upstream.Content = new ByteArrayContent(buffer.ToArray());
            if (ctx.Request.ContentType is { } contentType)
            {
                upstream.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
            }
        }

    foreach (var header in ctx.Request.Headers)
    {
        if (header.Key.StartsWith("Host", StringComparison.OrdinalIgnoreCase) ||
            header.Key.StartsWith("Content-", StringComparison.OrdinalIgnoreCase))
        {
            continue;
        }

        upstream.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
    }

    try
    {
        using var response = await client.SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
        ctx.Response.StatusCode = (int)response.StatusCode;

        foreach (var header in response.Headers)
        {
            ctx.Response.Headers[header.Key] = header.Value.ToArray();
        }

        foreach (var header in response.Content.Headers)
        {
            ctx.Response.Headers[header.Key] = header.Value.ToArray();
        }

        ctx.Response.Headers.Remove("transfer-encoding");
        await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
    }
    catch (HttpRequestException ex)
    {
        ctx.Response.StatusCode = (int)HttpStatusCode.BadGateway;
        await ctx.Response.WriteAsJsonAsync(new
        {
            code = -1,
            msg = "SDK server unreachable",
            detail = ex.Message,
        }, ctx.RequestAborted);
    }
});

app.Run();