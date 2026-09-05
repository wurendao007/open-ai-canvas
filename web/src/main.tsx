import { bootstrapAppearance } from "@/services/appearance-bootstrap";

void bootstrapAppearance().finally(() => import("./application"));
