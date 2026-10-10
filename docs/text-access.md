# Community access and moderation

Open **Manage access** to configure roles, ranks, categories, text channels, member assignments and the community voice room. The owner has an explicit exception. Delegated policy managers need both ManageRoles and ManageChannels; invitation, member and message management have separate permissions. There are no global Identity roles granting community access.

Each active member has everyone plus assigned roles. Base grants and applicable category/resource Allows combine, then every applicable Deny is removed. A channel Allow cannot override a category or another role's Deny. Sending requires viewing; voice connection requires ViewChannel and ConnectVoice, and publication additionally requires SpeakVoice. Nonmembers and banned members have no access. Leaving, kicking or banning removes assigned roles; joining again does not restore them.

For a private resource, remove everyone's base ViewChannel, allow everyone on public resources and allow a selected role on the private resource. Denying everyone also denies members with custom roles. Voice has its own rules and optional category, independent of text navigation. Read-only/listen-only UI explains the denial source.

## Delegation and hierarchy

Everyone has rank 0; other roles have ranks 1–1000. A member's rank is their highest role rank. Delegates cannot change equal/higher-ranked roles or members, assign a role at their own rank, or grant permissions they do not possess. The owner is protected from kick/ban. Changed resource policies also require current ManageChannels on affected resources. Role/invitation/member management are community grants; resource rules accept only permissions applicable to that resource. Management does not bypass a private ViewChannel denial.

| Permission | Mask | Use |
| --- | --- | --- |
| ViewChannel | 1 | Text history/recovery and voice visibility |
| SendMessage | 2 | Send and change one's own messages |
| ManageMessages | 4 | Delete others' messages in a visible text channel |
| ManageChannels | 32 | Configure affected resources |
| ManageRoles | 64 | Policy management and audit access |
| ManageInvites | 128 | Create/list/revoke invitations |
| KickMembers | 512 | Remove a lower-ranked member |
| BanMembers | 1024 | Ban/unban a lower-ranked member |
| ConnectVoice | 2048 | Join and renew a voice lease |
| SpeakVoice | 4096 | Publish microphone audio |
| ModerateVoice | 8192 | Disconnect a lower-ranked participant's specific lease |

Files, reactions and emoji permissions are reserved until their workflows exist. There is one logical community voice room. Ownership transfer, resource deletion and existing-channel renaming are unavailable.

## API and consistency

All paths start with /api/v1/communities/{id}. Authenticated reads are no-store; mutations require CSRF and use the existing account command limit.

- GET/PUT /access: bounded whole-policy management. Supply clientRequestId and the loaded string policy version. Stale versions or changed payloads under a reused ID return 409; exact retries return current and originally applied versions. The UI preserves a conflicting draft until explicit reload.
- POST /members/{memberId}/kick: repeat-safe removal; invite/ban endpoints use their separate permissions and hierarchy checks.
- POST /voice/disconnect: specific leaseId, ModerateVoice and hierarchy checks. Retrying an old lease cannot disconnect a newer session.
- GET /audit: ManageRoles required, latest 100 entries containing actor, action, target ID and timestamp. No message bodies, invitation codes or account credentials. This is a bounded moderation view, without pagination or production retention guarantees.

Policy bounds: 20 roles including everyone, 20 categories, 50 text channels, 500 member assignment entries, 400 category rules, 1000 channel rules and 20 voice rules. Cross-community references, duplicate IDs/rules, unsupported bits and removal of existing resources are rejected. Composite database keys enforce resource/role associations.

Policy saves, membership changes, message commands, reads and publication serialize under the PostgreSQL community lock. Durable receipts bind request identity, actor and payload hash. Voice Connect/View or Speak changes affecting an active lease persist Pending in the same transaction and use the protected generation transition described in [voice development](voice-development.md). A database change alone is not proof of media cutoff during a control outage.

Navigation filters hidden channels. Direct hidden-channel metadata/history/recovery returns 404; visible-channel send denial returns 403. SignalR subscription, publication and reconciliation check current access. The UI removes denied resource/management caches while preserving accessible community resources. Already delivered information cannot be recalled.

Two additive migrations seed everyone grants for existing communities and preserve prior voice access while introducing independent voice rules. Existing memberships, resources and message history are retained. Pinned framework/package versions are unchanged. Implementation follows official [resource authorization](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resource-based?view=aspnetcore-10.0) and [composite key](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/foreign-and-principal-keys) guidance.

Run npm run check, npm run test:database and npm run test:e2e. Cases cover private reads/recovery/publication, Deny precedence, cross-community IDs, concurrent/stale/repeated commands, hierarchy, revocation, moderation recovery and desktop/mobile states. File/search authorization cases belong with those future executable workflows.
