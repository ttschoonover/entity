// twofactor · email two-factor sign-in, decided by the members and enforced by
// the node. Settings only: no email address ever reaches the record. The node
// keeps members' addresses in its own .entity/twofactor.json, emails a six-digit
// code at sign-in, and accepts acts over the web from a member who uses
// two-factor only from a browser that gave the code (see cli/twofactor.js).
//
//   twofactor.require   optional | officers | everyone
//                       optional: each member chooses; officers: anyone holding
//                       an office or a committee seat must use it; everyone: all
//   twofactor.code_minutes   how long a code works
export default { name: 'twofactor', core: '0.7.7', install() {}, parameterKeys: ['twofactor.require', 'twofactor.code_minutes'] };
