using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace App.Api.Features.Accounts;

// Controller-only APIs do not register MVC's view-specific antiforgery filters.
public sealed class CsrfFilter(IAntiforgery antiforgery) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var method = context.HttpContext.Request.Method;
        if (context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<App.Api.Features.Voice.VoiceWebhookAttribute>() is not null) return;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)) return;

        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Request verification failed. Refresh your session and try again.",
            }) { StatusCode = StatusCodes.Status400BadRequest };
        }
    }
}
