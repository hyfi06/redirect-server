const UserService = require('../api/users/services/user.service');
const GroupService = require('../api/groups/services/group.service');
const MembershipService = require('../api/users/services/membership.service');
const ApiKeyService = require('../api/users/services/api-key.service');
const RedirectServiceApi = require('../api/redirect/services/redirect.service');

// Internal — not exported. A bare UserService with no membershipService, passed to
// GroupService to break the circular dependency: UserService depends on GroupService
// (via membershipService), and GroupService depends on UserService (fetch-first in update()).
const userServiceForGroup = new UserService();

const groupService = new GroupService(userServiceForGroup);
const membershipService = new MembershipService(userServiceForGroup, groupService);
const userService = new UserService(membershipService);
const apiKeyService = new ApiKeyService();
const redirectServiceApi = new RedirectServiceApi();

module.exports = {
  userService,
  groupService,
  membershipService,
  apiKeyService,
  redirectServiceApi,
  // Alias used by the public catch-all router (src/redirect/routes/redirect.router.js).
  // Same instance — both surfaces share the same singleton.
  redirectService: redirectServiceApi,
};
