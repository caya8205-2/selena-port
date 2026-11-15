using System.Collections.Concurrent;

namespace AscNet.WebPanel;

public sealed record CatalogEntry(long Id, string Name, string Meta);

/// <summary>
/// Read-only view over the server's TSV tables, used only to populate the panel's
/// search dropdowns. The upstream server keeps its own typed readers; this one
/// deliberately stays dumb: first two meaningful columns, cached per file and
/// invalidated when the file timestamp changes.
/// </summary>
public sealed class Catalog
{
    /// <summary>Which real column becomes the card's second line, if any.</summary>
    private enum Extra
    {
        None,
        TradeName,
        Star,
    }

    private static readonly Dictionary<string, (string File, string IdColumn, string NameColumn, Extra Extra)> Sources =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["items"] = ("share/item/Item.tsv", "Id", "Name", Extra.None),
            ["characters"] = ("share/character/Character.tsv", "Id", "Name", Extra.TradeName),
            ["equips"] = ("share/equip/Equip.tsv", "Id", "Name", Extra.Star),
            ["stages"] = ("share/fuben/Stage.tsv", "StageId", "Name", Extra.None),
        };

    private readonly ConcurrentDictionary<string, (DateTime Stamp, CatalogEntry[] Entries)> _cache = new();
    private readonly string _tableRoot;
    private readonly ILogger _log;

    public Catalog(string? resourcesDir, ILogger log)
    {
        _tableRoot = Path.Combine(resourcesDir ?? string.Empty, "table");
        _log = log;
    }

    public bool TryGet(string kind, out CatalogEntry[] entries)
    {
        entries = Array.Empty<CatalogEntry>();
        if (!Sources.TryGetValue(kind, out var source))
        {
            return false;
        }

        var path = Path.Combine(_tableRoot, source.File.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(path))
        {
            _log.LogWarning("Catalog table missing: {Path}", path);
            return false;
        }

        var stamp = File.GetLastWriteTimeUtc(path);
        if (_cache.TryGetValue(kind, out var hit) && hit.Stamp == stamp)
        {
            entries = hit.Entries;
            return true;
        }

        entries = Parse(path, source.IdColumn, source.NameColumn, source.Extra);
        _cache[kind] = (stamp, entries);
        return true;
    }

    private static CatalogEntry[] Parse(string path, string idColumn, string nameColumn, Extra extra)
    {
        var lines = File.ReadAllLines(path);
        if (lines.Length < 2)
        {
            return Array.Empty<CatalogEntry>();
        }

        var header = lines[0].Split('\t');
        var idIndex = Find(header, idColumn);
        var nameIndex = Find(header, nameColumn);
        if (idIndex < 0 || nameIndex < 0)
        {
            return Array.Empty<CatalogEntry>();
        }

        var extraColumn = extra switch
        {
            Extra.TradeName => "TradeName",
            Extra.Star => "Star",
            _ => null,
        };
        var extraIndex = extraColumn is null ? -1 : Find(header, extraColumn);

        var result = new List<CatalogEntry>(lines.Length - 1);
        var widest = Math.Max(idIndex, Math.Max(nameIndex, extraIndex));

        for (var i = 1; i < lines.Length; i++)
        {
            var row = lines[i].Split('\t');
            if (row.Length <= widest)
            {
                continue;
            }

            if (!long.TryParse(row[idIndex].Trim(), out var id))
            {
                continue;
            }

            var name = row[nameIndex].Trim();
            if (name.Length == 0)
            {
                continue;
            }

            // The second line of a card comes straight from the table: a construct's
            // trade name, an equip's star rating. Empty when the table has neither.
            var meta = extra switch
            {
                Extra.TradeName when extraIndex >= 0 && row[extraIndex].Trim() is { Length: > 0 } trade => trade,
                Extra.Star when extraIndex >= 0 && int.TryParse(row[extraIndex].Trim(), out var star) => $"{star}\u2605",
                _ => string.Empty,
            };

            result.Add(new CatalogEntry(id, name, meta));
        }

        return result.ToArray();
    }

    private static int Find(string[] header, string column)
    {
        for (var i = 0; i < header.Length; i++)
        {
            if (header[i].Trim().Equals(column, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }
}