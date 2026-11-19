// Dev entry (npm run dev): mounts the viewer from source with the fake service
import { mountProjectPage } from "../src/index";
import { createFakeService, fakeDataRequest } from "./fakeService.js";

mountProjectPage({
  container: "#emflow-host",
  service: createFakeService(),
  // Answers the fake requests of the viewers (e.g. ?compareTable sets)
  loader: { request: fakeDataRequest },
  // ?project=<name>: the fake project as another one (copy / paste between tabs)
  projectName: new URLSearchParams(location.search).get("project") ?? "43",
});
