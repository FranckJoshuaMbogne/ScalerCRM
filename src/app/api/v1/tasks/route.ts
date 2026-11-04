import { handleApi } from "@/modules/api/http";
import { createTask } from "@/modules/api/resources";

export function POST(request: Request) {
  return handleApi(request, createTask);
}
