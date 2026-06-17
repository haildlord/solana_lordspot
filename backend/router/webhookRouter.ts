import { Router } from "express";
import {webhookController} from "../controller/webhookController";

const router = Router();

router.post(`/helius`, webhookController);

export default router;