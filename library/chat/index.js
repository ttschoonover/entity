// chat · conversations in channels, like a group chat, kept by the node and
// never written to the record. Settings only: the members decide by law which
// channels exist, who may read and write in each, who moderates, and how long
// messages are kept; the node (cli/chat.js) does the rest.
//
// Every message is signed in the page with its author's own key (namespace
// entity.chat), so the node cannot forge one and nobody can post as someone
// else. Messages are not part of the public record: they are deleted after
// chat.retention_days, and an author or a moderator can delete one sooner.
//
//   chat.channels        [{ id, title, about?, read, post, encrypt? }]
//                        read: public | members        who can read it
//                        post: members | office:ID | committee:ID   who can write in it
//                        encrypt: false                 members-only channels are end-to-end
//                                                       encrypted unless this says otherwise
//   chat.moderators      office:ID | committee:ID | "" (no moderators: authors only)
//   chat.retention_days  how long the node keeps a message
//   chat.max_length      the longest message, in characters
//   chat.room_creators   who may open rooms of their own (members | office:ID | committee:ID | "")
//   chat.max_rooms       how many rooms may be open at once
//   chat.direct_messages whether members write to each other directly, sealed for the two of them
export default { name: 'chat', core: '0.7.7', install() {}, parameterKeys: ['chat.channels', 'chat.moderators', 'chat.retention_days', 'chat.max_length', 'chat.room_creators', 'chat.max_rooms', 'chat.direct_messages'] };
