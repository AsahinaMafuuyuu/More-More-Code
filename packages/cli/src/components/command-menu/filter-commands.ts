// 通过用户输入的指令来从命令列表中过滤出匹配的指令
import { type Command } from "./types";
import { COMMANDS } from "./commands";

export function getFilteredCommands(query: string): Command[] {
  if (query.length === 0) {
    return COMMANDS; 
  }
  return COMMANDS.filter((command) => command.name.toLowerCase().startsWith(query.toLowerCase()));
}