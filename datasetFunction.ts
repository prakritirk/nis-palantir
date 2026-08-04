import { Function, Query } from "@foundry/functions-api" 
import { UseCases } from "../domain/UseCases";
import { DasUseCase, Objects } from "@foundry/ontology-api";
import { Documents } from "../domain/Documents";
import { Datasets } from "../domain/Datasets";

export class DatasetFunctions {
    @Query({ apiName: "dasGetUseCases" })
    public async getAllUseCases(): Promise<UseCases[]> {
        const allUseCases = await Objects.search().dasUseCase().all();
        
        return allUseCases.map(obj => ({
            id: obj.usecaseId,
            name: obj.name,
            groupId: obj.groupId
        }));
    }

    @Query({ apiName: "dasGetDatasets" })
    public async getAllDatasets(): Promise<Datasets[]> {
        const allDatasets = await Objects.search().dasDataset().all();
        
        return allDatasets.map(obj => ({
            id: obj.datasetId,
            name: obj.name,
            useCaseId: obj.usecaseId
        }));
    }

    @Query({ apiName: "dasGetDocuments" })
    public async queryDocuments(datasetId: string): Promise<Documents[]> {
        const allDocuments = await Objects.search().dasDocument().filter(obj => obj.datasetId.exactMatch(datasetId)).allAsync();
        
        return allDocuments.map(obj => ({
            name: obj.name,
            id: obj.documentId,
            datasetId: obj.datasetId,
            documentProcessStatus: obj.documentProcessStatus,
            predictionStatus: obj.predictionStatus,
            file: (obj.file as any).rid,
            textFile: (obj.textFile as any).rid,
            matrixFile: (obj.textFile as any).rid,
        }));
    }


    @Function()
    public async getUseCases(): Promise<DasUseCase[]> {
        return Objects.search().dasUseCase().all()
    }

    @Function()
    public async isDatasetSelected(datasetId: string): Promise<boolean> {
        const count: (number | null) = await Objects.search().dasDataset().filter(dataset => dataset.datasetId.exactMatch(datasetId)).count();
        return count ? count > 0 : false;
    }
}
