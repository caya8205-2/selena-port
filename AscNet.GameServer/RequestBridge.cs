using System.Reflection;
using MessagePack;

namespace AscNet.GameServer
{
    /// <summary>
    /// Runs one of the game's own request handlers for an administrative command.
    /// <para>
    /// The panel must not re-implement what a handler already decides (costs, limits, ownership,
    /// which box a resonance comes out of), so a builder command builds the same request the
    /// client would and hands it to the registered handler. The handler answers through
    /// <c>SendResponse</c>; the bridge captures that packet and reports the handler's own code.
    /// </para>
    /// </summary>
    public static class RequestBridge
    {
        public sealed record Outcome(bool Accepted, int Code, object? Response);

        public static Outcome Run<TRequest>(Session session, string handlerName, TRequest request, int packetId = 1)
        {
            RequestPacketHandlerDelegate handler = PacketFactory.GetRequestPacketHandler(handlerName)
                ?? throw new InvalidOperationException($"no request handler is registered for {handlerName}.");

            int before = session.CapturedOutbound.Count;
            session.CaptureOutbound = true;
            try
            {
                handler(session, new Packet.Request
                {
                    Id = packetId,
                    Name = handlerName,
                    Content = MessagePackSerializer.Serialize(request, Packet.InboundOptions),
                });
            }
            finally
            {
                session.CaptureOutbound = false;
            }

            // Handlers answer with a Response packet; a fire-and-forget request answers nothing, and
            // then "accepted" means the handler returned without an error code.
            Packet? packet = session.CapturedOutbound
                .Skip(before)
                .LastOrDefault(candidate => candidate.Type == Packet.ContentType.Response);
            session.CapturedOutbound.RemoveRange(before, session.CapturedOutbound.Count - before);

            if (packet is null)
                return new Outcome(true, 0, null);

            Packet.Response response = MessagePackSerializer.Deserialize<Packet.Response>(packet.Content, Packet.InboundOptions);
            object? payload = Decode(response);
            int code = Code(payload);
            return new Outcome(code == 0, code, payload);
        }

        private static object? Decode(Packet.Response response)
        {
            Assembly assembly = typeof(PacketFactory).Assembly;
            Type? type = assembly.GetType(response.Name)
                ?? assembly.GetType("AscNet.GameServer.Handlers." + response.Name)
                ?? assembly.GetType("AscNet.GameServer." + response.Name);
            return type is null ? null : MessagePackSerializer.Deserialize(type, response.Content, Packet.InboundOptions);
        }

        /// <summary>The generated responses carry a public <c>Code</c> field; nothing else is assumed.</summary>
        private static int Code(object? response)
        {
            if (response is null)
                return 0;

            Type type = response.GetType();
            FieldInfo? field = type.GetField("Code");
            if (field?.GetValue(response) is int fieldValue)
                return fieldValue;

            PropertyInfo? property = type.GetProperty("Code");
            return property?.GetValue(response) is int propertyValue ? propertyValue : 0;
        }
    }
}