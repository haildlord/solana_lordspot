import { Router } from "express";
import {quoteController} from "../controller/quoteController";

const router = Router();

router.post(`/quote`, quoteController);

export default router;