using AscNet.Common.Util;
using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Table.V2.share.equip;
using AscNet.Table.V2.share.item;
using AscNet.Common.MsgPack;
using AscNet.GameServer.Handlers;

namespace AscNet.GameServer.Commands
{
    [CommandName("equip")]
    internal class EquipCommand : Command
    {
        private object? payload;

        public EquipCommand(Session session, string[] args, bool validate = true) : base(session, args, validate)
        {
        }

        public override string Help =>
            "Equips: add <id|all> [copies], prune, sync, feed <id>, break <id>, awake <id> <slot> [costType], " +
            "resonate <id> <slot> <attrib|skill|weapon> <selectionId> [characterId], overrun <id> [times], suit <id> <suitId>.";

        public override object? Payload => payload;

        [Argument(0, @"^add$|^prune$|^sync$|^feed$|^break$|^awake$|^resonate$|^overrun$|^suit$", "The operation selected", ArgumentFlags.IgnoreCase)]
        string Op { get; set; } = string.Empty;

        [Argument(1, @"^[0-9]+$|^all$", "The target equip, value is equip id or 'all'", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Target { get; set; } = string.Empty;

        [Argument(2, @"^[0-9]+$", "Copies to add, a resonance slot, times to overrun, or a suit id", ArgumentFlags.Optional)]
        string Arg1 { get; set; } = "1";

        [Argument(3, @"^[0-9]+$|^attrib$|^skill$|^weapon$", "Resonance type, awaken cost type, or a selection id", ArgumentFlags.IgnoreCase | ArgumentFlags.Optional)]
        string Arg2 { get; set; } = string.Empty;

        [Argument(4, @"^[0-9]+$", "Resonance selection id", ArgumentFlags.Optional)]
        string Arg3 { get; set; } = string.Empty;

        [Argument(5, @"^[0-9]+$", "Character the resonance belongs to", ArgumentFlags.Optional)]
        string Arg4 { get; set; } = string.Empty;

        public override void Execute()
        {
            if (Op.Equals("sync", StringComparison.OrdinalIgnoreCase))
            {
                SyncEquipsFromDatabase();
                return;
            }

            NotifyEquipDataList notifyEquipData = new();


            switch (Op)
            {
                case "add":
                    if (Target == "all")
                    {
                        // The bulk path takes the panel's Amount too, clamped low because every missing entry is
                        // created that many times: one per entry is the default, a handful is the ceiling.
                        int bulkCopies = Math.Clamp(Miscs.ParseIntOr(Arg1), 1, 99);
                        HashSet<uint> ownedTemplateIds = session.character.Equips
                            .Select(equip => equip.TemplateId)
                            .ToHashSet();
                        foreach (EquipTable equip in TableReaderV2.Parse<EquipTable>()
                                     .Where(equip => !ownedTemplateIds.Contains((uint)equip.Id)))
                        {
                            for (int index = 0; index < bulkCopies; index += 1)
                            {
                                EquipData? newEquip = session.character.AddEquip((uint)equip.Id);
                                if (newEquip is null)
                                    break;
                                ownedTemplateIds.Add(newEquip.TemplateId);
                                notifyEquipData.EquipDataList.Add(newEquip);
                            }
                        }
                    }
                    else
                    {
                        var equip = TableReaderV2.Parse<EquipTable>().Find(x => x.Id == Miscs.ParseIntOr(Target)) ?? throw new ServerCodeException("Equip by id not found", 20021001);

                        // One id per call, and an optional count so the panel's Amount field means
                        // the same thing here as it does for items.
                        int copies = Math.Clamp(Miscs.ParseIntOr(Arg1), 1, 999);
                        for (int index = 0; index < copies; index += 1)
                        {
                            var newEquip = session.character.AddEquip((uint)equip.Id);
                            if (newEquip is not null)
                                notifyEquipData.EquipDataList.Add(newEquip);
                        }
                    }
                    break;
                case "prune":
                    PruneDuplicateWeapons(notifyEquipData);
                    break;
                case "feed":
                    payload = FeedEquip(RequireEquipId());
                    return;
                case "break":
                    payload = Invoke(nameof(EquipBreakthroughRequest), new EquipBreakthroughRequest { EquipId = RequireEquipId() });
                    return;
                case "awake":
                    payload = Invoke(nameof(EquipAwakeRequest), new EquipAwakeRequest
                    {
                        EquipId = RequireEquipId(),
                        Slot = RequireNumber(Arg1, "a resonance slot"),
                        CostType = Miscs.ParseIntOr(Arg2),
                    });
                    return;
                case "resonate":
                    payload = Resonate(RequireEquipId());
                    return;
                case "overrun":
                    payload = Overrun(RequireEquipId(), Miscs.ParseIntOr(Arg1));
                    return;
                case "suit":
                    payload = Invoke(nameof(EquipWeaponChoseOverrunSuitRequest), new EquipWeaponChoseOverrunSuitRequest
                    {
                        EquipId = RequireEquipId(),
                        SuitId = RequireNumber(Arg1, "a suit id"),
                    });
                    return;
                default:
                    throw new InvalidOperationException("Invalid operation!");
            }

            if (notifyEquipData.EquipDataList.Count > 0 || notifyEquipData.DeletedEquipIdList.Count > 0)
                session.character.SaveChecked();

            session.SendPush(notifyEquipData);
        }

        private void PruneDuplicateWeapons(NotifyEquipDataList notifyEquipData)
        {
            Dictionary<uint, EquipTable> equipRowsById = TableReaderV2.Parse<EquipTable>()
                .ToDictionary(row => (uint)row.Id);
            foreach (IGrouping<uint, EquipData> duplicates in session.character.Equips
                         .Where(equip => equipRowsById.TryGetValue(equip.TemplateId, out EquipTable? row)
                             && row.Site == 0)
                         .GroupBy(equip => equip.TemplateId))
            {
                if (duplicates.Count() < 2)
                    continue;

                List<EquipData> removable = duplicates
                    .Where(IsUninvestedDuplicateWeapon)
                    .OrderBy(equip => equip.Id)
                    .ToList();
                int pristineToKeep = duplicates.Count() == removable.Count ? 1 : 0;
                foreach (EquipData equip in removable.Skip(pristineToKeep))
                {
                    session.character.Equips.Remove(equip);
                    notifyEquipData.DeletedEquipIdList.Add(equip.Id);
                }
            }
        }

        private bool IsUninvestedDuplicateWeapon(EquipData equip)
        {
            return equip.CharacterId == 0
                && !equip.IsLock
                && !equip.IsRecycle
                && !session.player.IsEquipInTeamPrefab(equip.Id)
                && equip.Level <= 1
                && equip.Exp <= 0
                && equip.Breakthrough <= 0
                && equip.ResonanceInfo.Count == 0
                && equip.UnconfirmedResonanceInfo.Count == 0
                && equip.AwakeSlotList.Count == 0
                && equip.WeaponOverrunData.Level <= 0
                && equip.WeaponOverrunData.ActiveSuits.Count == 0
                && equip.WeaponOverrunData.ChoseSuit <= 0;
        }

        private int RequireEquipId()
        {
            int id = Miscs.ParseIntOr(Target);
            if (id <= 0)
                throw new InvalidOperationException("A numeric equip id is required.");
            return id;
        }

        private static int RequireNumber(string value, string what)
        {
            int number = Miscs.ParseIntOr(value);
            if (number <= 0)
                throw new InvalidOperationException($"{what} is required.");
            return number;
        }

        /// <summary>
        /// Run the game's own request handler for this equip. The panel must not decide what a
        /// handler decides (costs, limits, ownership), so the command builds the client's request
        /// and reports the handler's own code.
        /// </summary>
        private object Invoke<TRequest>(string handlerName, TRequest request)
        {
            RequestBridge.Outcome outcome = RequestBridge.Run(session, handlerName, request);
            return new
            {
                ok = outcome.Accepted,
                handler = handlerName,
                code = outcome.Code,
                response = outcome.Response,
            };
        }

        /// <summary>
        /// Feed one equip to its current breakthrough's level limit with the material the account
        /// already owns. The exp curve is the template's, the coin cost is the handler's; only the
        /// counts (largest exp first, exactly enough) are decided here, which is what the client
        /// does when it fills the feed slots.
        /// </summary>
        private object FeedEquip(int equipId)
        {
            EquipData equip = session.character.Equips.FirstOrDefault(candidate => candidate.Id == equipId)
                ?? throw new InvalidOperationException($"this account has no equip {equipId}.");
            EquipBreakThroughTable progression = Character.ResolveEquipBreakThrough(equip.TemplateId, equip.Breakthrough)
                ?? throw new InvalidOperationException("this equip has no breakthrough row.");

            int targetLevel = progression.LevelLimit;
            long neededExp = ExpToLevel(equip, progression, targetLevel);
            if (neededExp <= 0)
                return new { ok = true, equipId, level = equip.Level, note = "already at this breakthrough's level limit" };

            List<(int Id, int Exp)> materials = TableReaderV2.Parse<ItemTable>()
                .Select(item => (item.Id, Info: item.GetEquipUpgradeInfo()))
                .Where(entry => entry.Info.Exp > 0 && (session.inventory.Items.FirstOrDefault(item => item.Id == entry.Id)?.Count ?? 0) > 0)
                .Select(entry => (entry.Id, entry.Info.Exp))
                .OrderByDescending(entry => entry.Exp)
                .ToList();

            Dictionary<int, int> useItems = new();
            long remaining = neededExp;
            foreach ((int id, int exp) in materials)
            {
                if (remaining <= 0) break;
                long owned = session.inventory.Items.First(item => item.Id == id).Count;
                int take = (int)Math.Min(owned, (remaining + exp - 1) / exp);
                if (take <= 0) continue;
                useItems[id] = take;
                remaining -= (long)take * exp;
            }

            if (remaining > 0)
                throw new InvalidOperationException($"not enough feed material: {neededExp - remaining} of {neededExp} exp covered.");

            return Invoke(nameof(EquipOneKeyFeedRequest), new EquipOneKeyFeedRequest
            {
                EquipId = equipId,
                TargetBreakthrough = equip.Breakthrough,
                TargetLevel = targetLevel,
                OperationInfos =
                [
                    new EquipFeedOperationInfo
                    {
                        OperationType = EquipModule.EquipFeedOperationTypeLevelUp,
                        UseItemIdList = useItems.Keys.ToList(),
                        UseItemCountList = useItems.Values.ToList(),
                    }
                ],
            });
        }

        private static long ExpToLevel(EquipData equip, EquipBreakThroughTable progression, int targetLevel)
        {
            long total = -equip.Exp;
            for (int level = equip.Level; level < targetLevel; level += 1)
            {
                EquipLevelUpTemplate? template = Character.equipLevelUpTemplates
                    .FirstOrDefault(row => row.TemplateId == progression.LevelUpTemplateId && row.Level == level);
                if (template is null)
                    return -1;
                total += template.Exp;
            }
            return Math.Max(0, total);
        }

        /// <summary>
        /// One selected resonance. A memory takes its selection from the slot's own pool (stats on
        /// slot 1, a skill on slot 2); a weapon takes a class skill from its skill pool. The select
        /// item is the one the table names for that equip, and the handler still checks ownership,
        /// the pool and the material balance.
        /// </summary>
        private object Resonate(int equipId)
        {
            EquipData equip = session.character.Equips.FirstOrDefault(candidate => candidate.Id == equipId)
                ?? throw new InvalidOperationException($"this account has no equip {equipId}.");
            _ = TableReaderV2.Parse<EquipTable>().FirstOrDefault(candidate => candidate.Id == (int)equip.TemplateId)
                ?? throw new InvalidOperationException("this equip has no Equip.tsv row.");

            int slot = RequireNumber(Arg1, "a resonance slot");
            int characterId = Miscs.ParseIntOr(Arg4);
            if (characterId <= 0)
            {
                // Slot 2 skills belong to a construct, and the handler refuses without one.
                characterId = session.character.Characters
                    .Select(character => character.Id)
                    .Cast<int>()
                    .FirstOrDefault(id => id > 0);
            }

            EquipResonanceType? type = Arg2.ToLowerInvariant() switch
            {
                "attrib" => EquipResonanceType.Attrib,
                "skill" => EquipResonanceType.CharacterSkill,
                "weapon" => EquipResonanceType.WeaponSkill,
                _ => null,
            };
            if (type is null)
                throw new InvalidOperationException("a resonance type is required: attrib, skill or weapon.");

            int selection = RequireNumber(Arg3, "a resonance selection id");
            EquipResonanceUseItemTable? useItem = TableReaderV2.Parse<EquipResonanceUseItemTable>()
                .FirstOrDefault(candidate => candidate.Id == (int)equip.TemplateId);
            // The client spends the "selected resonance" item; the table names it per equip.
            int selectItemId = useItem?.SelectSkillItemId ?? 0;
            if (selectItemId <= 0)
                throw new InvalidOperationException("this equip has no selected-resonance item in EquipResonanceUseItem.tsv.");

            return Invoke(nameof(EquipResonanceRequest), new EquipResonanceRequest
            {
                EquipId = equipId,
                Slots = [slot],
                UseItemId = selectItemId,
                SelectSkillIds = [selection],
                SelectType = type,
                CharacterId = characterId,
            });
        }

        /// <summary>Raise a weapon's overrun level, one level per request, up to the given count.</summary>
        private object Overrun(int equipId, int times)
        {
            int count = Math.Clamp(times <= 0 ? 1 : times, 1, 10);
            List<object> results = new();
            for (int index = 0; index < count; index += 1)
            {
                RequestBridge.Outcome outcome = RequestBridge.Run(session, nameof(EquipWeaponOverrunLevelUpRequest),
                    new EquipWeaponOverrunLevelUpRequest { EquipId = equipId });
                results.Add(new { code = outcome.Code, accepted = outcome.Accepted, data = outcome.Response });
                if (!outcome.Accepted)
                    break;
            }
            return new { ok = results.Count > 0, equipId, steps = results, };
        }

        private void SyncEquipsFromDatabase()
        {
            session.character = Character.FromUid(session.player.PlayerData.Id, session.player.GatherRewards);
            AccountModule.SendLoginState(session);
        }
    }
}
