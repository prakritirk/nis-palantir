import { Attachment, Edits, Filters, Function, OntologyEditFunction, Timestamp } from "@foundry/functions-api" 
import { DasAnnotation, DasAnnotationGroup, DasDocument, DasPrediction, DasDocumentMetaData, Objects } from "@foundry/ontology-api";
import { ActionTypes, DocumentProcessStatus } from "../enums/enums";
import { nisabaClaimsPrediction } from "@foundry/ontology-api/queries";
import { documentExtract } from "@swissredas/computemodules";
import { createMatrixFile, createTextFile } from "../utils/FileUtils";
import { PredictionStatus } from "../models";
import { Uuid } from "@foundry/functions-utils";
import { MAX_OBJECTS } from "../utils/Constants";
import { LogFunctions } from "./LogFunctions";

export class DocumentFunctions {

    @Edits(DasDocument)
    @OntologyEditFunction()
    public async deleteAllDocuments(datasetId: string, userId: string): Promise<void> {
        let hasMore = true;
        let offset = 0;

        const documents = await Objects.search().dasDocument().filter(doc => doc.datasetId.exactMatch(datasetId)).all();	

        await Promise.all(documents.map((document: DasDocument) => this.deleteDocument(document, userId)));

        console.log("Finished deleting all objects.");
    }
    
    @Edits(DasDocument, DasAnnotation)
    @OntologyEditFunction()
    public async deleteDocuments(documents: DasDocument[], userId: string): Promise<void> {
        await Promise.all(documents.map((document: DasDocument) => this.deleteDocument(document, userId)));
    }

    @Edits(DasDocument, DasAnnotation)
    @OntologyEditFunction()
    public async deleteDocument(document: DasDocument, userId: string): Promise<void> {
        const annotations = await Objects.search().dasAnnotation().filter(annotation => annotation.documentId.exactMatch(document.documentId)).allAsync();
        await Promise.all(annotations.map((annotation: DasAnnotation) => annotation.delete()));
        const predictions = await Objects.search().dasPrediction().filter(prediction => prediction.documentId.exactMatch(document.documentId)).all();
        await Promise.all(predictions.map((prediction: DasPrediction) => prediction.delete()));
        const metadatas = await Objects.search().dasDocumentMetaData().filter(metadata => metadata.documentId.exactMatch(document.documentId)).all();
        await Promise.all(metadatas.map((metadata: DasDocumentMetaData) => metadata.delete()));

        await LogFunctions.logAction(
            ActionTypes.DELETE_DOCUMENT, 
            userId, 
            document.datasetId
        );

        document.delete();
    }

    @OntologyEditFunction()
    public async documentMarkError(document: DasDocument): Promise<void> {
        document.documentProcessStatus = DocumentProcessStatus.ERROR;
    }



    @Function() 
    public async documentModelClaims(textExtraction: string): Promise<string> {
        return await nisabaClaimsPrediction({ text: textExtraction });
    }

    @Function()
    public async textextract(document: DasDocument): Promise<string> {

        const attachment = document.file;
        const attachmentId = (attachment as any).rid;
        console.log("attachment: ", attachmentId);

        const documentExtractResult = await documentExtract({ attachmentId: attachmentId });   
    return documentExtractResult.extractedText;
    }

    @Edits(DasDocument)
    @OntologyEditFunction()
    public async documentTransform(document: DasDocument): Promise<void> {
        try {
            const attachment = document.file;

            if (typeof attachment === 'undefined') return;

            const attachmentId = (attachment as any).rid;
            console.log("attachment: ", attachmentId);

            const documentExtractResult = await documentExtract({ attachmentId: attachmentId });             //Aqui

            document.matrixFile = await createMatrixFile(documentExtractResult.csv, `${document.name}`);
            document.textFile = await createTextFile(documentExtractResult.extractedText, `${document.name}`);
            console.log("matrixFile", document.matrixFile);
            console.log("textFile", document.textFile);
        } catch(error) {
            console.log(error)
            if(document !== undefined) {
                document.predictionStatus = PredictionStatus.FAILED;
                document.documentProcessStatus = DocumentProcessStatus.ERROR;
            }
        }
    }

    @Function()	
    public async readDocumentStatus(documentId: string): Promise<string> {	
        const document = Objects.search().dasDocument().filter(doc => doc.documentId.exactMatch(documentId)).all();	
        if(document.length === 0) {	
            throw new Error("Document " + documentId + " does not exist");	
        }	
        const documentStatus = document[0].documentProcessStatus;	
        return documentStatus ?? DocumentProcessStatus.UNDEFINED;	
    } 

     @Function()	
    public async readDocumentPredictionStatus(documentId: string): Promise<string> {	
        const document = Objects.search().dasDocument().filter(doc => doc.documentId.exactMatch(documentId)).all();	
        if(document.length === 0) {	
            throw new Error("Document " + documentId + " does not exist");	
        }	
        const predictionStatus = document[0].predictionStatus;	
        return predictionStatus ?? PredictionStatus.NOT_APPLICABLE;	
    } 
 
    @Edits(DasDocument)
    @OntologyEditFunction()
    public async documentUploads(attachments: Attachment[],
                                datasetId: string,
                                created: Timestamp,
                                uploaderId: string,
                                permissionGroupId: string): Promise<void> {
        let uploadFilenames: string[] = [];
        let duplicateFilenames: string[] = [];
        let notAllowedFilenames: string [] = [];
        const documents = Objects.search().dasDocument().filter(doc => doc.datasetId.exactMatch(datasetId)).all().map((doc: DasDocument) => doc.name);                                    
        for(let i = 0; i < attachments.length; i++) {
            const attachment = attachments[i];
            // eslint-disable-next-line no-await-in-loop
            const newFileName = (await attachment.getMetadataAsync()).filename;

            if (!newFileName.toLowerCase().endsWith(".pdf")){
                notAllowedFilenames.push(newFileName);
                continue
            }

            if((documents.findIndex(doc => doc?.toUpperCase() === newFileName.toUpperCase()) > -1) || uploadFilenames.includes(newFileName))  {
                duplicateFilenames.push(newFileName);
                continue;
            }
            uploadFilenames.push(newFileName);

            const newDocument = Objects.create().dasDocument(Uuid.random().toString());
            newDocument.created = created;
            newDocument.datasetId = datasetId;
            newDocument.file = attachment;
            newDocument.name = newFileName;
            newDocument.permissionGroupId = permissionGroupId;
            newDocument.uploaderId = uploaderId;
            newDocument.documentProcessStatus = DocumentProcessStatus.IN_PROGRESS;
        
            LogFunctions.logAction(ActionTypes.UPLOAD_DOCUMENT, uploaderId, datasetId);
        }

        if (notAllowedFilenames.length > 0){
            const naFilenames = " - "+ notAllowedFilenames.join("\n - ");
            throw new Error("\nNot allowed file types detected:\n" + naFilenames + "\nPlease upload only PDF files.");
        }

        if (duplicateFilenames.length > 0){
            const dFilenames = " - "+ duplicateFilenames.join("\n - ");
            throw new Error("\nDuplicate filenames detected:\n" + dFilenames + "\nPlease rename your files and try again.");
        }
    }

    @Function()
    public async isMatrixReady(documentId: string): Promise<boolean> {
        const document = Objects.search().dasDocument().filter(doc => doc.documentId.exactMatch(documentId)).all();

        if(document.length === 0) {
            throw new Error("Document " + documentId + " does not exist");
        }

        const matrix = document[0].matrixFile;

        return matrix !== undefined && (await matrix.readAsync()).size > 0;
    }                 
}