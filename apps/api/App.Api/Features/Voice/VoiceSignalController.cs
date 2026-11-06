using System.Net.WebSockets;
using App.Api.Features.DirectMessages;
using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Voice;

[ApiController, AllowAnonymous, Route("livekit")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class VoiceSignalController(VoiceAdmission admission, DirectCallAdmission calls) : ControllerBase
{
    [HttpGet("{**path}"), EnableRateLimiting("voice-joins")]
    public async Task Signal(string? path, CancellationToken ct)
    {
        var direct = path?.StartsWith("direct/", StringComparison.Ordinal) == true;
        if (direct) path = path![7..];
        if (path is not ("rtc" or "rtc/v1" or "rtc/validate" or "rtc/v1/validate")) { Response.StatusCode = 404; return; }
        var token = Request.Query["access_token"];
        if (token.Count != 1 || Request.QueryString.Value?.Length > 16384) { Response.StatusCode = 401; return; }
        foreach (var item in Request.Query)
            if (item.Value.Count != 1 || item.Key is "publish" or "metadata" or "attributes") { Response.StatusCode = 400; return; }
        try
        {
            if (path.EndsWith("/validate", StringComparison.Ordinal))
            {
                if (direct) await calls.ValidateAsync(token[0] ?? "", ct); else await admission.ValidateAsync(token[0] ?? "", ct); await Response.WriteAsync("success", ct); return;
            }
            if (!HttpContext.WebSockets.IsWebSocketRequest) { Response.StatusCode = 404; return; }
            using var upstream = direct ? await calls.ConnectAsync(token[0] ?? "", "/" + path, Request.QueryString.Value ?? "", ct) : await admission.ConnectAsync(token[0] ?? "", "/" + path, Request.QueryString.Value ?? "", ct);
            using var downstream = await HttpContext.WebSockets.AcceptWebSocketAsync();
            using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var toServer = Pump(downstream, upstream, lifetime.Token);
            var toClient = Pump(upstream, downstream, lifetime.Token);
            await Task.WhenAny(toServer, toClient);
            await lifetime.CancelAsync(); upstream.Abort(); downstream.Abort();
            try { await Task.WhenAll(toServer, toClient); }
            catch (Exception e) when (e is OperationCanceledException or WebSocketException) { }
        }
        catch (CommunityFailure error) when (!Response.HasStarted) { Response.StatusCode = error.Status; }
        catch (Exception e) when (e is OperationCanceledException or WebSocketException or HttpRequestException)
        { if (!Response.HasStarted) Response.StatusCode = 503; }
    }

    private static async Task Pump(WebSocket source, WebSocket target, CancellationToken ct)
    {
        var buffer = new byte[16384];
        var bytes = 0;
        while (!ct.IsCancellationRequested)
        {
            var read = await source.ReceiveAsync(buffer.AsMemory(), ct);
            if (read.MessageType == WebSocketMessageType.Close)
            {
                using var closing = CancellationTokenSource.CreateLinkedTokenSource(ct); closing.CancelAfter(1000);
                await target.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Voice signaling closed", closing.Token); return;
            }
            bytes += read.Count;
            if (bytes > 1048576) throw new WebSocketException("Voice signaling message exceeds its bound.");
            await target.SendAsync(buffer.AsMemory(0, read.Count), read.MessageType, read.EndOfMessage, ct);
            if (read.EndOfMessage) bytes = 0;
        }
    }
}
