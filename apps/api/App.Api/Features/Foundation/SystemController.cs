using App.Core.Foundation;
using Microsoft.AspNetCore.Mvc;

namespace App.Api.Features.Foundation;

[ApiController]
[Route("api/v1/system")]
public sealed class SystemController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<FoundationInfo>(StatusCodes.Status200OK)]
    public ActionResult<FoundationInfo> Get() => new FoundationInfo("Dosvyazi", "Development foundation");
}
