namespace App.Api.Features.Accounts;

public sealed class SameOriginMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var unsafeMethod = !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
            !HttpMethods.IsOptions(context.Request.Method);
        if (unsafeMethod && context.Request.Headers.TryGetValue("Origin", out var origin))
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
