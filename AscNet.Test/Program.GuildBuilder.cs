using AscNet.Common;
using AscNet.Common.Database;
using AscNet.Common.MsgPack;
using AscNet.Common.Util;
using AscNet.GameServer;
using AscNet.GameServer.Handlers;
using AscNet.Table.V2.share.config;
using AscNet.Table.V2.share.guild;
using MessagePack;
using MongoDB.Driver;
using Newtonsoft.Json.Linq;
using DbCharacter = AscNet.Common.Database.Character;

namespace AscNet.Test
{
    internal partial class Program
    {
        private const long GuildBuilderUid = 90_7401;
        private const long GuildBuilderTouristUid = 90_7402;
        private const long GuildBuilderOutsiderUid = 90_7403;
        private const uint GuildBuilderGuildId = 98_990_001;

        /// <summary>
        /// The guild command against a seeded guild: info reads the row and the membership through
        /// the guild module, exp moves build, fund and contribution move the pool the guild spends
        /// as funds, a grant above the daily donation limit needs confirm, and the module's own
        /// membership check refuses a tourist with its own code.
        /// </summary>
        private static void ValidateGuildBuilderCompatibility()
        {
            AscNet.GameServer.Commands.CommandFactory.LoadCommands();

            GuildLevelTable levelRow = TableReaderV2.Parse<GuildLevelTable>().OrderBy(row => row.Level).First();
            GuildHeadPortraitTable portrait = TableReaderV2.Parse<GuildHeadPortraitTable>()
                .First(row => !(row.ConditionId > 0) && !(row.Cost > 0));
            int dailyLimit = GuildModule.LocalGuildWishPolicy.DailyDonationLimit;
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            Guild guild = new()
            {
                Id = GuildBuilderGuildId,
                Name = "builder-" + Guid.NewGuid().ToString("N")[..10],
                IconId = portrait.Id,
                Level = levelRow.Level,
                LeaderId = GuildBuilderUid,
                Declaration = "guild builder fixture",
                Option = 2,
                MinLevel = 1,
                CreatedAt = now,
                Active = true,
                CreationReserved = false,
                Version = 1,
                MemberIds = [GuildBuilderUid, GuildBuilderTouristUid],
                Members =
                {
                    [GuildBuilderUid] = new GuildMemberState { Rank = 1, JoinedAt = now },
                    [GuildBuilderTouristUid] = new GuildMemberState { Rank = 5, JoinedAt = now },
                },
                MaxMembers = levelRow.Capacity,
                MaxTourists = levelRow.PositionNum[2],
                GiftGuildLevel = levelRow.Level,
            };

            try
            {
                DeleteGuildBuilderFixtures();
                Guild.collection.InsertOne(guild);

                using LoopbackSessionHarness leader = OpenGuildBuilderPlayer(GuildBuilderUid);
                using LoopbackSessionHarness tourist = OpenGuildBuilderPlayer(GuildBuilderTouristUid);
                using LoopbackSessionHarness outsider = OpenGuildBuilderPlayer(GuildBuilderOutsiderUid);

                // 1. The read model: row, membership, rank and the caps the level row defines.
                JObject info = RunGuildCommand(leader, "info");
                AssertEqual(true, info["ok"]!.Value<bool>(), "guild info ok");
                AssertEqual((int)GuildBuilderGuildId, info["guild"]!["id"]!.Value<int>(), "guild info id");
                AssertEqual(guild.Name, info["guild"]!["name"]!.Value<string>(), "guild info name");
                AssertEqual(levelRow.Level, info["guild"]!["level"]!.Value<int>(), "guild info level");
                AssertEqual(0, info["guild"]!["build"]!.Value<int>(), "guild info build");
                AssertEqual(0, info["guild"]!["funds"]!.Value<int>(), "guild info funds");
                AssertEqual(1, info["member"]!["rank"]!.Value<int>(), "guild info leader rank");
                AssertEqual(0, info["member"]!["totalContribution"]!.Value<int>(), "guild info contribution");
                AssertEqual(1, info["guild"]!["memberCount"]!.Value<int>(), "guild info member count excludes tourists");
                AssertEqual(1, info["guild"]!["touristCount"]!.Value<int>(), "guild info tourist count");
                AssertEqual(levelRow.Capacity, info["caps"]!["capacity"]!.Value<int>(), "guild info capacity");
                AssertEqual(levelRow.Build, info["caps"]!["buildForNextLevel"]!.Value<int>(), "guild info build for next level");
                AssertEqual(dailyLimit, info["caps"]!["dailyDonationLimit"]!.Value<int>(), "guild info daily donation limit");

                JObject touristInfo = RunGuildCommand(tourist, "info");
                AssertEqual(5, touristInfo["member"]!["rank"]!.Value<int>(), "guild info tourist rank");
                AssertEqual("tourist", touristInfo["member"]!["rankName"]!.Value<string>(), "guild info tourist rank name");

                // 2. exp moves build and reports the economy events the module broadcasts.
                JObject expGrant = RunGuildCommand(leader, "grant", "exp", "1000");
                AssertEqual("exp", expGrant["kind"]!.Value<string>(), "guild grant exp kind");
                AssertEqual(1000, expGrant["amount"]!.Value<int>(), "guild grant exp amount");
                AssertEqual(40, expGrant["itemId"]!.Value<int>(), "guild grant exp item");
                AssertEqual(1000, expGrant["after"]!["build"]!.Value<int>(), "guild grant exp build");
                AssertEqual(0, expGrant["after"]!["funds"]!.Value<int>(), "guild grant exp leaves the funds alone");
                AssertEqual(
                    1000,
                    Guild.collection.Find(row => row.Id == GuildBuilderGuildId).Single().Build,
                    "guild grant exp persisted");
                AssertGuildEvent(leader, 11, "guild grant exp talent point push");
                AssertGuildEvent(leader, 2, "guild grant exp build push");

                // 3. Above the daily donation limit the grant is refused until it says confirm,
                // and the refusal moves nothing.
                string overLimit = GuildCommandRefusal(leader, "grant", "contribution", (dailyLimit + 5).ToString());
                if (!overLimit.Contains("confirm", StringComparison.Ordinal))
                    throw new InvalidDataException($"guild builder: expected a confirm requirement, got '{overLimit}'.");
                Guild afterRefusal = Guild.collection.Find(row => row.Id == GuildBuilderGuildId).Single();
                AssertEqual(0, afterRefusal.ContributeLeft, "guild grant refusal leaves the funds alone");
                AssertEqual(1000, afterRefusal.Build, "guild grant refusal leaves the build alone");

                // 4. fund under the limit needs no confirm and credits the acting member.
                JObject fundGrant = RunGuildCommand(leader, "grant", "fund", "2");
                AssertEqual(2, fundGrant["after"]!["funds"]!.Value<int>(), "guild grant fund pool");
                AssertEqual(2, fundGrant["member"]!["weekContribution"]!.Value<int>(), "guild grant fund member weeks");
                AssertEqual(2, fundGrant["member"]!["totalContribution"]!.Value<int>(), "guild grant fund member total");
                AssertGuildEvent(leader, 1, "guild grant fund pool push");
                AssertGuildEvent(leader, 3, "guild grant fund gift contribution push");

                // 5. A confirmed contribution grant above the limit still uses the same flow.
                JObject contribution = RunGuildCommand(leader, "grant", "contribution", "25", "confirm");
                AssertEqual(true, contribution["confirmed"]!.Value<bool>(), "guild grant contribution confirmed");
                AssertEqual(27, contribution["after"]!["funds"]!.Value<int>(), "guild grant contribution pool");
                AssertEqual(27, contribution["member"]!["totalContribution"]!.Value<int>(), "guild grant contribution member total");
                AssertGuildEvent(leader, 1, "guild grant contribution pool push");
                AssertGuildEvent(leader, 3, "guild grant contribution gift push");

                JObject reread = RunGuildCommand(leader, "info");
                AssertEqual(27, reread["guild"]!["funds"]!.Value<int>(), "guild info reads the granted funds back");
                AssertEqual(27, reread["guild"]!["contributionIn7Days"]!.Value<int>(), "guild info reads the seven day contribution");
                AssertEqual(27, reread["member"]!["contributionIn7Days"]!.Value<int>(), "guild info reads the member contribution");
                AssertEqual(27, reread["member"]!["totalContribution"]!.Value<int>(), "guild info reads the member total");

                // 6. The module's own checks refuse: a tourist is not a contributing member, and
                // an account outside the guild has no guild to grant to.
                string touristRefusal = GuildCommandRefusal(tourist, "grant", "exp", "1");
                if (!touristRefusal.Contains("20063029", StringComparison.Ordinal))
                    throw new InvalidDataException($"guild builder: expected the module's membership code, got '{touristRefusal}'.");
                string outsiderRefusal = GuildCommandRefusal(outsider, "grant", "exp", "1");
                if (!outsiderRefusal.Contains("not in a guild", StringComparison.Ordinal))
                    throw new InvalidDataException($"guild builder: expected a no-guild refusal, got '{outsiderRefusal}'.");
                string outsiderInfo = GuildCommandRefusal(outsider, "info");
                if (!outsiderInfo.Contains("not in a guild", StringComparison.Ordinal))
                    throw new InvalidDataException($"guild builder: expected a no-guild refusal from info, got '{outsiderInfo}'.");

                // 7. The command's own argument grammar refuses an unknown resource. CommandFactory
                // builds the command through reflection, so the grammar error arrives wrapped.
                bool syntaxRefused = false;
                try
                {
                    _ = AscNet.GameServer.Commands.CommandFactory.CreateCommand("guild", leader.Session, ["grant", "money", "5"]);
                }
                catch (System.Reflection.TargetInvocationException exception) when (exception.InnerException is ArgumentException)
                {
                    syntaxRefused = true;
                }
                AssertEqual(true, syntaxRefused, "guild grant rejects an unknown resource");

                // 8. At the highest authored level the module keeps build convertible: the interval
                // and the talent point count are authored config values, so nothing is invented here.
                Dictionary<string, string> config = TableReaderV2.Parse<ConfigTable>()
                    .ToDictionary(row => row.Key, row => row.Value);
                int interval = int.Parse(config["GuildBuildIntervalWhenMaxLevel"], System.Globalization.CultureInfo.InvariantCulture);
                int pointsPerInterval = int.Parse(config["GuildTalentPointCountWhenMaxLevel"], System.Globalization.CultureInfo.InvariantCulture);
                GuildLevelTable lastLevel = TableReaderV2.Parse<GuildLevelTable>().OrderBy(row => row.Level).Last();
                Guild atMax = Guild.collection.Find(row => row.Id == GuildBuilderGuildId).Single();
                atMax.Level = lastLevel.Level;
                atMax.MaxMembers = lastLevel.Capacity;
                atMax.GiftGuildLevel = lastLevel.Level;
                Guild.collection.ReplaceOne(row => row.Id == GuildBuilderGuildId, atMax);
                int talentBefore = atMax.TalentPoint;
                long buildAfterGrant = 1000L + interval;
                JObject maxLevelGrant = RunGuildCommand(leader, "grant", "exp", interval.ToString());
                AssertEqual(lastLevel.Level, maxLevelGrant["after"]!["level"]!.Value<int>(), "guild grant exp at max level keeps the level");
                AssertEqual((int)(buildAfterGrant % interval), maxLevelGrant["after"]!["build"]!.Value<int>(), "guild grant exp at max level leaves the remainder");
                AssertEqual(talentBefore + (int)(buildAfterGrant / interval) * pointsPerInterval,
                    maxLevelGrant["after"]!["talentPoint"]!.Value<int>(), "guild grant exp at max level converts to talent points");
                if (!maxLevelGrant["note"]!.Value<string>().Contains("talent point", StringComparison.Ordinal))
                    throw new InvalidDataException("guild builder: expected the max-level talent point note.");

                Console.WriteLine(
                    $"guild builder: {guild.Name} at level {levelRow.Level} took build 1000 and pool 27 "
                    + $"(member total 27), level {lastLevel.Level} turned {interval} build into {pointsPerInterval} talent points, "
                    + $"tourist and outsider refused, grant above {dailyLimit} needs confirm");
            }
            finally
            {
                DeleteGuildBuilderFixtures();
            }
        }

        private static LoopbackSessionHarness OpenGuildBuilderPlayer(long uid)
        {
            Player player = CreateDrawCompatibilityPlayer(uid);
            DbCharacter character = CreateDrawCompatibilityCharacter(uid);
            Inventory inventory = CreateDrawCompatibilityInventory(uid, []);
            Stage stage = CreateLoginAccountCompatibilityStage(uid);
            Player.collection.InsertOne(player);
            DbCharacter.collection.InsertOne(character);
            Inventory.collection.InsertOne(inventory);
            Stage.collection.InsertOne(stage);
            return new LoopbackSessionHarness(character, player, inventory, $"guild-builder-{uid}", startClientLoop: false);
        }

        private static void DeleteGuildBuilderFixtures()
        {
            Guild.collection.DeleteMany(row => row.Id == GuildBuilderGuildId
                || row.LeaderId == GuildBuilderUid
                || row.LeaderId == GuildBuilderTouristUid
                || row.LeaderId == GuildBuilderOutsiderUid);
            Player.collection.DeleteMany(row => row.PlayerData.Id == GuildBuilderUid
                || row.PlayerData.Id == GuildBuilderTouristUid
                || row.PlayerData.Id == GuildBuilderOutsiderUid);
            DbCharacter.collection.DeleteMany(row => row.Uid == GuildBuilderUid
                || row.Uid == GuildBuilderTouristUid
                || row.Uid == GuildBuilderOutsiderUid);
            Inventory.collection.DeleteMany(row => row.Uid == GuildBuilderUid
                || row.Uid == GuildBuilderTouristUid
                || row.Uid == GuildBuilderOutsiderUid);
            Stage.collection.DeleteMany(row => row.Uid == GuildBuilderUid
                || row.Uid == GuildBuilderTouristUid
                || row.Uid == GuildBuilderOutsiderUid);
        }

        private static JObject RunGuildCommand(LoopbackSessionHarness harness, params string[] args)
        {
            AscNet.GameServer.Commands.Command command =
                AscNet.GameServer.Commands.CommandFactory.CreateCommand("guild", harness.Session, args)
                ?? throw new InvalidDataException($"guild builder: expected the guild command for [{string.Join(", ", args)}].");
            command.Execute();
            return command.Payload is null
                ? throw new InvalidDataException($"guild builder: [{string.Join(", ", args)}] returned no payload.")
                : JObject.FromObject(command.Payload);
        }

        private static string GuildCommandRefusal(LoopbackSessionHarness harness, params string[] args)
        {
            try
            {
                _ = RunGuildCommand(harness, args);
            }
            catch (Exception exception)
            {
                return exception.Message;
            }

            throw new InvalidDataException($"guild builder: [{string.Join(", ", args)}] was expected to be refused.");
        }

        private static void AssertGuildEvent(LoopbackSessionHarness harness, int type, string name)
        {
            Packet packet = harness.ReadPacket(name);
            AssertEqual(Packet.ContentType.Push, packet.Type, $"{name} packet type");
            Packet.Push push = MessagePackSerializer.Deserialize<Packet.Push>(packet.Content);
            AssertEqual(nameof(NotifyGuildEvent), push.Name, $"{name} packet name");
            NotifyGuildEvent payload = MessagePackSerializer.Deserialize<NotifyGuildEvent>(push.Content);
            AssertEqual(type, payload.Type, $"{name} event type");
        }
    }
}