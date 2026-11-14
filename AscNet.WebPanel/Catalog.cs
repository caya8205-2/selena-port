using System.Collections.Concurrent;

namespace AscNet.WebPanel;

public sealed record CatalogEntry(long Id, string Name);

/// <summary>
/// Read-only view over the server's TSV tables, used only to populate the panel's
/// search dropdowns. The upstream server keeps its own typed readers; this one
/// deliberately stays dumb: first two meaningful columns, cached per file and
/// invalidated when the file timestamp changes.
/// </summary>
public sealed class Catalog
{
    private static readonly Dictionary<string, (string File, string IdColumn, string NameColumn)> Sources = new(StringComparer.OrdinalIgnoreCase)
    {
        ["items"] = ("share/item/Item.tsv", "Id", "Name"),
        ["characters"] = ("share/character/Character.tsv", "Id", "Name"),
        ["equips"] = ("share/equip/Equip.tsv", "Id", "Name"),
        ["stages"] = ("share/fuben/Stage.tsv", "StageId", "Name"),
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

        entries = Parse(path, source.IdColumn, source.NameColumn);
        _cache[kind] = (stamp, entries);
        return true;
    }

    private static CatalogEntry[] Parse(string path, string idColumn, string nameColumn)
    {
        var lines = File.ReadAllLines(path);
        if (lines.Length < 2)
        {
            return Array.Empty<CatalogEntry>();
        }

        var header = lines[0].Split('\t');
        var idIndex = Array.FindIndex(header, h => h.Trim().Equals(idColumn, StringComparison.OrdinalIgnoreCase));
        var nameIndex = Array.FindIndex(header, h => h.Trim().Equals(nameColumn, StringComparison.OrdinalIgnoreCase));
        if (idIndex < 0 || nameIndex < 0)
        {
            return Array.Empty<CatalogEntry>();
        }

        var result = new List<CatalogEntry>(lines.Length - 1);
        for (var i = 1; i < lines.Length; i++)
        {
            var row = lines[i].Split('\t');
            if (row.Length <= Math.Max(idIndex, nameIndex))
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

            result.Add(new CatalogEntry(id, name));
        }

        return result.ToArray();
    }
}