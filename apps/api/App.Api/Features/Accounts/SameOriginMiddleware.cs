namespace App.Api.Features.Accounts;

public sealed class SameOriginMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var unsafeMethod = !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
            !HttpMethods.IsOptions(context.Request.Method);
        // CORS does not protect WebSockets. All browser hub transports must supply
        // our exact Origin, including GET upgrade and long-polling requests.
        if (context.Request.Path.StartsWithSegments("/hubs") && !context.Request.Headers.ContainsKey("Origin"))
        {
            await Results.Problem(statusCode: 403, title: "An explicit same-origin connection is required.").ExecuteAsync(context);
            return;
        }
        if ((unsafeMethod || context.Request.Path.StartsWithSegments("/hubs")) && context.Request.Headers.TryGetValue("Origin", out var origin))
        {
            var expected = $"{context.Request.Scheme}://{context.Request.Host}";
            if (origin.Count != 1 || !string.Equals(origin[0], expected, StringComparison.OrdinalIgnoreCase))
            {
                await Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Cross-origin requests are not allowed.")
                    .ExecuteAsync(context);
                return;
            }
        }
        await next(context);
    }
}
