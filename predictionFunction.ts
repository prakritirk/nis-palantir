import { Edits, Function, OntologyEditFunction, Timestamp } from "@foundry/functions-api" 
import { DasDocument, DasPrediction, Objects } from "@foundry/ontology-api";
import { DocumentProcessStatus } from "../enums/enums";
import { DatasetModelTypes, FLOW_TYPES, PredictionStatus } from "../models";
import { readFileText } from "../utils/FileUtils";
import { nisabaClaimsPrediction, nisabaUwPrediction } from "@foundry/ontology-api/queries";
import { documentExtract } from "@swissredas/computemodules";
import { Uuid } from "@foundry/functions-utils";
import { MAX_OBJECTS } from "../utils/Constants";

export class PredictionsFunctions {
    @Edits(DasPrediction)
    @OntologyEditFunction() 
    public async generatePredictionsFromPredictions(document: DasDocument): Promise<void> {
        if(document.documentProcessStatus !== DocumentProcessStatus.ERROR) {
            if (document.predictionStatus !== PredictionStatus.SUCCESS) {
                const modelForPrediction = await Objects.search().datasetModels().filter(datasetModel => datasetModel.datasetId.exactMatch(document.datasetId!)).allAsync();
                if (modelForPrediction.length > 0) {

                    document.predictionStatus = PredictionStatus.FAILED;
                    let predictions;
                    if(modelForPrediction[0].model === DatasetModelTypes.CLAIMS) {
                        predictions = await nisabaClaimsPrediction({ text: await readFileText(document.textFile) });
                        console.log("length: ", predictions.length);
                    } else if(modelForPrediction[0].model === DatasetModelTypes.UNDERWRITING) {
                        const documentExtractResult = await documentExtract({ attachmentId: (document.file as any).rid }); 
                        predictions = await nisabaUwPrediction({ text_array: documentExtractResult.extractedTextByPage});
                    } 
                    
                    console.log("length predictions: ", predictions);   
                    if(predictions && predictions.length > 0) {
                        const newPrediction = await Objects.create().dasPrediction(Uuid.random());
                        newPrediction.created = Timestamp.now();
                        newPrediction.createdBy = document.uploaderId;
                        newPrediction.metadata = predictions;
                        newPrediction.type = FLOW_TYPES.OFFSET;
                        newPrediction.documentId = document.documentId
                        console.log("predictions:", JSON.stringify(predictions, null, 2));
                        console.log(PredictionStatus.SUCCESS);
                        document.predictionStatus = PredictionStatus.SUCCESS;
                    } else {
                        document.predictionStatus = PredictionStatus.NOT_APPLICABLE;
                        document.documentProcessStatus = DocumentProcessStatus.DONE
                    }
                } else {
                    document.predictionStatus = PredictionStatus.NOT_APPLICABLE;
                    document.documentProcessStatus = DocumentProcessStatus.DONE
                }
            } 
        } else {
            document.predictionStatus = PredictionStatus.NOT_APPLICABLE;
        }
    }

    @Edits(DasPrediction)
    @OntologyEditFunction()
    public async deletePredictions(predictions: DasPrediction[]): Promise<void> {
        predictions.forEach((prediction: DasPrediction) => prediction.delete());
    }

    @Edits(DasPrediction)
    @OntologyEditFunction()
    public async deleteAllPredictions(): Promise<void> {
        const predictions = await Objects.search().dasPrediction().orderBy(obj => obj.predictionId.desc()).take(MAX_OBJECTS)	

        for (const prediction of predictions) {
            prediction.delete();
        }

        console.log("Finished deleting all objects.");
    }
}




