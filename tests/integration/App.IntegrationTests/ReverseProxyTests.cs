using System.Net;
using Microsoft.AspNetCore.Http;

namespace App.IntegrationTests;

public sealed class ReverseProxyTests
{
    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    public async Task TrustedLoopbackProxyPreservesHttpsAndSecureCookies(string address)
    {
        await using var factory = new FoundationFactory("Production", reverseProxy: true);
        _ = factory.CreateClient();
        var result = await factory.Server.SendAsync(context =>
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse(address);
            context.Request.Host = new HostString("dosvyazi.example");
            context.Request.Scheme = "http";
            context.Request.Path = "/api/v1/account/csrf";
            context.Request.Headers["X-Forwarded-For"] = "192.0.2.40";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
            context.Request.Headers["X-Forwarded-Host"] = "evil.example";
        });
        Assert.Equal(200, result.Response.StatusCode);
        Assert.Equal("https", result.Request.Scheme);
        Assert.Equal("dosvyazi.example", result.Request.Host.Value);
        Assert.Equal(IPAddress.Parse("192.0.2.40"), result.Connection.RemoteIpAddress);
        Assert.Contains("secure", result.Response.Headers.SetCookie.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UntrustedProxyCannotForgeHttpsOrClientAddress()
    {
        await using var factory = new FoundationFactory("Production", reverseProxy: true);
        _ = factory.CreateClient();
        var result = await factory.Server.SendAsync(context =>
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.41");
            context.Request.Host = new HostString("dosvyazi.example");
            context.Request.Scheme = "http";
            context.Request.Path = "/health/live";
            context.Request.Headers["X-Forwarded-For"] = "192.0.2.40";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
        });
        Assert.Equal(307, result.Response.StatusCode);
        Assert.Equal("http", result.Request.Scheme);
        Assert.Equal(IPAddress.Parse("192.0.2.41"), result.Connection.RemoteIpAddress);
        Assert.Equal("https://dosvyazi.example/health/live", result.Response.Headers.Location.ToString());
    }

    [Theory]
    [InlineData(true, "https://dosvyazi.example", 401)]
    [InlineData(true, "https://evil.example", 403)]
    [InlineData(false, "https://dosvyazi.example", 403)]
    public async Task HubOriginUsesTrustedForwardedSchemeOnlyWhenEnabled(bool enabled, string origin, int status)
    {
        await using var factory = new FoundationFactory(reverseProxy: enabled);
        _ = factory.CreateClient();
        var result = await factory.Server.SendAsync(context =>
        {
            context.Connection.RemoteIpAddress = IPAddress.Loopback;
            context.Request.Host = new HostString("dosvyazi.example");
            context.Request.Scheme = "http";
            context.Request.Path = "/hubs/messages";
            context.Request.Headers.Origin = origin;
            context.Request.Headers["X-Forwarded-For"] = "192.0.2.40";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
        });
        Assert.Equal(status, result.Response.StatusCode);
    }
}
