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

    private static readonly Dictionary<string, (string File, string IdColumn, string NameColumn, Extra Extra, string? ZeroColumn, bool Invert, string? SlotColumn)> Sources =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["items"] = ("share/item/Item.tsv", "Id", "Name", Extra.None, null, false, null),
            ["characters"] = ("share/character/Character.tsv", "Id", "Name", Extra.TradeName, null, false, null),
            ["equips"] = ("share/equip/Equip.tsv", "Id", "Name", Extra.Star, null, false, null),
            ["stages"] = ("share/fuben/Stage.tsv", "StageId", "Name", Extra.None, null, false, null),
            ["scenes"] = ("share/photomode/Background.tsv", "Id", "Name", Extra.None, null, false, null),
            // A weapon is the only equip with a weapon skill; memories hold 0 there.
            ["weapons"] = ("share/equip/Equip.tsv", "Id", "Name", Extra.Star, "WeaponSkillId", true, null),
            ["memories"] = ("share/equip/Equip.tsv", "Id", "Name", Extra.Star, "Site", true, "Site"),
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

        entries = Parse(path, source.IdColumn, source.NameColumn, source.Extra, source.ZeroColumn, source.Invert, source.SlotColumn);
        _cache[kind] = (stamp, entries);
        return true;
    }

    /// <summary>
    /// Coatings of one character, read from share/fashion/Fashion.tsv. Kept separate
    /// from the flat catalogs because it depends on a chosen character; the second
    /// line carries the quality tier the client shows as its own badge.
    /// </summary>
    public CatalogEntry[] CoatingsFor(long characterId)
    {
        var path = Path.Combine(_tableRoot, Path.Combine("share", "fashion", "Fashion.tsv"));
        if (!File.Exists(path))
        {
            _log.LogWarning("Fashion table missing: {Path}", path);
            return Array.Empty<CatalogEntry>();
        }

        var key = "fashion:" + characterId;
        var stamp = File.GetLastWriteTimeUtc(path);
        if (_cache.TryGetValue(key, out var hit) && hit.Stamp == stamp)
        {
            return hit.Entries;
        }

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2)
        {
            return Array.Empty<CatalogEntry>();
        }

        var header = lines[0].Split('\t');
        var idIndex = Find(header, "Id");
        var nameIndex = Find(header, "Name");
        var ownerIndex = Find(header, "CharacterId");
        var qualityIndex = Find(header, "Quality");
        if (idIndex < 0 || nameIndex < 0 || ownerIndex < 0)
        {
            return Array.Empty<CatalogEntry>();
        }

        var widest = Math.Max(idIndex, Math.Max(nameIndex, Math.Max(ownerIndex, qualityIndex)));
        var result = new List<CatalogEntry>();

        for (var i = 1; i < lines.Length; i++)
        {
            var row = lines[i].Split('\t');
            if (row.Length <= widest || !long.TryParse(row[ownerIndex].Trim(), out var owner) || owner != characterId)
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


            var quality = qualityIndex >= 0 ? row[qualityIndex].Trim() : string.Empty;
            result.Add(new CatalogEntry(id, name, quality.Length > 0 ? "tier " + quality : string.Empty));
        }

        var entries = result.ToArray();
        _cache[key] = (stamp, entries);
        return entries;
    }

    private static CatalogEntry[] Parse(string path, string idColumn, string nameColumn, Extra extra, string? zeroColumn = null, bool invert = false, string? slotColumn = null)
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
        var zeroIndex = zeroColumn is null ? -1 : Find(header, zeroColumn);
        var slotIndex = slotColumn is null ? -1 : Find(header, slotColumn);

        var result = new List<CatalogEntry>(lines.Length - 1);
        var widest = Math.Max(idIndex, Math.Max(nameIndex, Math.Max(extraIndex, Math.Max(zeroIndex, slotIndex))));

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

            if (zeroIndex >= 0)
            {
                var isZero = row[zeroIndex].Trim() is "0" or "";
                if (invert ? isZero : !isZero)
                {
                    continue;
                }
            }

            // The second line of a card comes straight from the table: a construct's
            // trade name, an equip's star rating. Empty when the table has neither.
            var meta = extra switch
            {
                Extra.TradeName when extraIndex >= 0 && row[extraIndex].Trim() is { Length: > 0 } trade => trade,
                Extra.Star when extraIndex >= 0 && int.TryParse(row[extraIndex].Trim(), out var star) => $"{star}\u2605",
                _ => string.Empty,
            };

            // A memory's grid number decides which of the six slots it may occupy, so the
            // card has to carry it the same way the Node server does.
            if (slotIndex >= 0)
            {
                var slot = row[slotIndex].Trim();
                if (slot.Length > 0 && slot != "0")
                {
                    meta = meta.Length > 0 ? $"{meta} \u00b7 Slot {slot}" : $"Slot {slot}";
                }
            }

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